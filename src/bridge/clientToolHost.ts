import type {
  ClientToolInvocation,
  ClientToolSchema,
  LoomcycleClient,
} from "@loomcycle/client";
import { clientToolsURL } from "@loomcycle/client";
import {
  BROWSER_TOOL_PREFIX,
  isMutating,
  type BrowserCommand,
  type BrowserOp,
  type BrowserResult,
} from "./protocol";
import { dispatchToTab } from "./dispatch";
import { approval } from "./approval";
import { bridgeStatus } from "./status";

// The browser tools this extension registers with loomcycle. loomcycle offers
// them to any agent of this user whose `tools:` allowlist grants `client__browser_*`
// (see ensureAgent.ts) — the agent calls e.g. `client__browser_read_page` and the
// invoke is routed here. Bare names are underscore-only: loomcycle prepends the
// `client__` prefix and requires the full name to be a wire-safe LLM function-name
// identifier (`[a-zA-Z0-9_-]`), so a dot would break the call. Descriptions carry
// the ref discipline; the system prompt (systemPrompt.ts) covers the loop + safety.
const BROWSER_TOOLS: ClientToolSchema[] = [
  {
    name: "browser_read_page",
    description:
      "Read the user's currently open web page. Returns a snapshot {url, title, refs:[{ref, role, name, tag, value, placeholder}], text}. Call this FIRST for any page task; only target refs from the LATEST snapshot.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_get_selection",
    description: "Return the text the user has currently selected on the page. Returns {text}.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_fill",
    description:
      "Type text into a form field addressed by its ref from the latest snapshot. Returns a fresh snapshot on success, or {ok:false,error:'stale_ref',snapshot} if the ref no longer resolves. May require the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from the latest read_page snapshot." },
        value: { type: "string", description: "Text to enter." },
        reason: { type: "string", description: "One short sentence shown to the user explaining this action." },
      },
      required: ["ref", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element addressed by its ref from the latest snapshot. Returns a fresh snapshot, or {ok:false,error:'stale_ref',snapshot}. May require the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from the latest read_page snapshot." },
        reason: { type: "string", description: "One short sentence shown to the user explaining this action." },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate",
    description:
      "Navigate the active tab to a URL. Returns {ok, url}. Follow with read_page to snapshot the loaded page. May require the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to open." },
        reason: { type: "string", description: "One short sentence shown to the user explaining this action." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

const KNOWN_OPS: ReadonlySet<string> = new Set([
  "read_page",
  "get_selection",
  "fill",
  "click",
  "navigate",
]);

export interface HostHandle {
  stop: () => void;
}

// Start the browser bridge: open a persistent WebSocket to loomcycle, register
// the browser tools, and answer each `client__browser_*` invoke by running it in
// the active tab. Runs in the side-panel document (persistent while open). The
// bearer rides inside the client (createLoomcycleClient's authToken); the server
// derives the (tenant, subject) routing key from it, so no userId is threaded —
// `userLabel` is display-only. Returns a handle to stop it (closes the socket +
// unblocks a waiting approval). Auto-reconnects on drop.
export function startClientToolHost(
  client: LoomcycleClient,
  // Whether a mutating op (fill/click/navigate) needs the user's approval.
  // Read per-call so a mid-run mode toggle takes effect.
  shouldConfirm: () => boolean,
  // Display-only: the whoami subject (shown when connected) and the loomcycle
  // base URL (used to show the exact WebSocket target when it can't connect).
  userLabel?: string,
  baseUrl?: string,
): HostHandle {
  let stopped = false;
  // Distinguish "never opened" (handshake failing — the socket never reached the
  // server) from "dropped after being open" (transient), so the status bar can
  // name the likely cause without devtools. everOpened flips true on the first
  // successful open; failedAttempts counts closes that never reached open.
  let everOpened = false;
  let failedAttempts = 0;
  const wsTarget = baseUrl ? clientToolsURL(baseUrl) : "the client-tool WebSocket";
  console.info(`[loomboard] client-tool host starting (user=${userLabel ?? "?"}, ws=${wsTarget})`);
  bridgeStatus.set("connecting", `connecting to ${wsTarget}…`);

  const host = client.connectClientTools({
    tools: BROWSER_TOOLS,
    onStatus: (s) => {
      if (stopped) return;
      if (s === "connecting") {
        bridgeStatus.set(
          "connecting",
          everOpened ? "reconnecting…" : `connecting to ${wsTarget}…`,
        );
      } else if (s === "open") {
        everOpened = true;
        failedAttempts = 0;
        bridgeStatus.set("connected", userLabel ? `user ${userLabel}` : "ready");
      } else if (everOpened) {
        // Was connected, then dropped — the host auto-reconnects.
        bridgeStatus.set("error", "connection dropped — reconnecting…");
      } else {
        // Never opened: the WebSocket handshake is failing. After a couple of
        // tries, name the usual cause — a runtime/proxy that doesn't allow the
        // WebSocket upgrade on /v1/client-tools (chat over https can succeed while
        // this fails). Panel devtools → Network → WS shows the exact status code.
        failedAttempts++;
        bridgeStatus.set(
          "error",
          failedAttempts >= 2
            ? `can't open ${wsTarget} — the runtime, or a proxy in front of it, may be blocking the WebSocket upgrade`
            : `can't reach ${wsTarget} — retrying…`,
        );
      }
    },
    onError: (e) => {
      if (!stopped) console.warn("[loomboard] client-tool host error:", e);
    },
    onInvoke: async (inv) => {
      const cmd = toCommand(inv);
      if (!cmd) {
        return { ok: false, op: inv.tool, error: `unsupported client tool: ${inv.tool}` };
      }
      console.info(`[loomboard] browser tool: ${cmd.op} (${inv.callId})`);
      if (!stopped) bridgeStatus.set("connected", `running ${cmd.op}…`);
      const result = await processInvoke(cmd, shouldConfirm);
      console.info(
        `[loomboard] browser result: ${cmd.op} ok=${result.ok}` +
          (result.error ? ` (${result.error})` : ""),
      );
      if (!stopped) {
        bridgeStatus.set(
          "connected",
          `last: ${cmd.op} → ${result.ok ? "ok" : result.error ?? result.status ?? "error"}`,
        );
      }
      return toOutput(result);
    },
  });

  return {
    stop: () => {
      stopped = true;
      approval.cancelPending(); // unblock a waiting approval (returns "declined")
      host.close();
    },
  };
}

// Map an inbound invocation to an internal BrowserCommand, or null if the tool
// isn't one we registered. The (tenant, subject) routing is done server-side —
// we only read the tool name + input. callId becomes the internal correlation id
// echoed back by the content script. Exported for unit testing.
export function toCommand(inv: ClientToolInvocation): BrowserCommand | null {
  const op = inv.tool.startsWith(BROWSER_TOOL_PREFIX)
    ? inv.tool.slice(BROWSER_TOOL_PREFIX.length)
    : inv.tool;
  if (!KNOWN_OPS.has(op)) return null;
  const input =
    inv.input && typeof inv.input === "object"
      ? (inv.input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    id: inv.callId,
    op: op as BrowserOp,
    ref: str(input.ref),
    value: str(input.value),
    url: str(input.url),
    reason: str(input.reason),
  };
}

// Execute one command, applying the confirm gate. Confirm mode: approve up
// front, then dispatch as confirmed. Autonomous (and read-only): dispatch
// directly — but if the executor flags a sensitive target (needs_confirm), fall
// back to an approval round and re-dispatch as confirmed. Never executes a
// mutating action the user hasn't approved when a gate applies.
async function processInvoke(
  cmd: BrowserCommand,
  shouldConfirm: () => boolean,
): Promise<BrowserResult> {
  if (isMutating(cmd.op) && shouldConfirm()) {
    const ok = await approval.request(cmd);
    if (!ok) return declinedResult(cmd);
    return dispatchToTab({ ...cmd, confirmed: true });
  }
  const res = await dispatchToTab(cmd);
  if (res.status !== "needs_confirm") return res;
  const ok = await approval.request(cmd);
  if (!ok) return declinedResult(cmd);
  return dispatchToTab({ ...cmd, confirmed: true });
}

function declinedResult(cmd: BrowserCommand): BrowserResult {
  return {
    id: cmd.id,
    ok: false,
    op: cmd.op,
    status: "declined",
    error: "declined by user",
  };
}

// Shape the result into the tool's JSON output the agent receives. Drops the
// internal correlation id (the agent already knows which tool it called; the
// runtime correlates by call id at the WebSocket layer). Exported for unit testing.
export function toOutput(res: BrowserResult): Record<string, unknown> {
  const out: Record<string, unknown> = { ok: res.ok, op: res.op };
  if (res.snapshot !== undefined) out.snapshot = res.snapshot;
  if (res.text !== undefined) out.text = res.text;
  if (res.url !== undefined) out.url = res.url;
  if (res.title !== undefined) out.title = res.title;
  if (res.error !== undefined) out.error = res.error;
  if (res.status !== undefined) out.status = res.status;
  return out;
}
