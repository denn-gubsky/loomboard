import type { LoomcycleClient } from "@loomcycle/client";
import {
  CMD_CHANNEL,
  RESULT_CHANNEL,
  isMutating,
  type BrowserCommand,
  type BrowserResult,
} from "./protocol";
import { dispatchToTab } from "./dispatch";
import { approval } from "./approval";
import { bridgeStatus } from "./status";

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
}

const WAIT_MS = 25_000; // < the server's 30s long-poll cap; empty batch = keep-alive
const MAX_MESSAGES = 5;
const RETRY_MS = 2_000;
const SEEN_CAP = 500;

export interface LoopHandle {
  stop: () => void;
}

// Start the browser bridge: long-poll browser.cmd (the agent's commands), execute
// each in the active tab, and publish the result to browser.result. Runs in the
// side-panel document (persistent while open, unlike the ephemeral service
// worker, so a 25s long-poll is never dropped mid-run). Returns a handle to stop
// it (aborts the poll + dispatch + result publish).
export function startChannelLoop(
  client: LoomcycleClient,
  userId: string,
  // Whether a mutating op (fill/click/navigate) needs the user's approval.
  // Reads the current mode each call (so a mid-run toggle takes effect).
  shouldConfirm: () => boolean,
): LoopHandle {
  const ac = new AbortController();
  const seen = new Set<string>();

  async function run(): Promise<void> {
    console.info(`[loomboard] browser bridge started (user=${userId})`);
    bridgeStatus.set("listening", `user ${userId}`);
    await drainBacklog();
    while (!ac.signal.aborted) {
      let batch;
      try {
        batch = await client.subscribeChannel(CMD_CHANNEL, {
          scope: "user",
          userId,
          waitMs: WAIT_MS,
          maxMessages: MAX_MESSAGES,
          signal: ac.signal,
        });
        bridgeStatus.set("listening", `user ${userId}`); // recover from any prior error
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn("[loomboard] browser.cmd subscribe failed (retrying):", e);
        bridgeStatus.set("error", errText(e));
        await sleep(RETRY_MS, ac.signal); // transient — back off, retry
        continue;
      }
      for (const msg of batch.messages) {
        if (ac.signal.aborted) return;
        const cmd = msg.value as BrowserCommand | null;
        if (!cmd || typeof cmd.id !== "string" || typeof cmd.op !== "string") {
          continue;
        }
        if (seen.has(cmd.id)) continue; // idempotent (belt-and-suspenders)
        if (seen.size > SEEN_CAP) seen.clear();
        seen.add(cmd.id);

        console.info(`[loomboard] browser cmd: ${cmd.op} (${cmd.id})`);
        const result = await processCommand(cmd, shouldConfirm, ac.signal);
        if (ac.signal.aborted) return;
        console.info(
          `[loomboard] browser result: ${cmd.op} ok=${result.ok}` +
            (result.error ? ` (${result.error})` : ""),
        );
        await publishResult(client, userId, result, ac.signal);
      }
    }
  }

  // Skip messages buffered before this session (stale prior-run commands) by
  // draining them via the committed cursor. This replaces a client-clock filter
  // (msg.published_at < Date.now()) that was UNSOUND across client/server clock
  // skew — if the browser's clock ran ahead of loomcycle's, it silently dropped
  // fresh commands as "stale", so the bridge never executed anything.
  async function drainBacklog(): Promise<void> {
    let dropped = 0;
    try {
      for (;;) {
        const d = await client.subscribeChannel(CMD_CHANNEL, {
          scope: "user",
          userId,
          waitMs: 0,
          maxMessages: 100,
          signal: ac.signal,
        });
        if (ac.signal.aborted || d.messages.length === 0) break;
        dropped += d.messages.length;
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        console.warn("[loomboard] browser.cmd drain failed:", e);
      }
    }
    if (dropped > 0) {
      console.info(`[loomboard] drained ${dropped} stale browser.cmd message(s)`);
    }
  }

  void run();
  return {
    stop: () => {
      approval.cancelPending(); // unblock a waiting approval so run() exits
      ac.abort();
    },
  };
}

// Execute one command, applying the confirm gate. Confirm mode: approve up
// front, then dispatch as confirmed. Autonomous (and read-only): dispatch
// directly — but if the executor flags a sensitive target (needs_confirm), fall
// back to an approval round and re-dispatch as confirmed. Never executes a
// mutating action the user hasn't approved when a gate applies.
async function processCommand(
  cmd: BrowserCommand,
  shouldConfirm: () => boolean,
  signal: AbortSignal,
): Promise<BrowserResult> {
  if (isMutating(cmd.op) && shouldConfirm()) {
    const ok = await approval.request(cmd);
    if (signal.aborted || !ok) return declinedResult(cmd, signal.aborted);
    return dispatchToTab({ ...cmd, confirmed: true });
  }
  const res = await dispatchToTab(cmd);
  if (res.status !== "needs_confirm") return res;
  const ok = await approval.request(cmd);
  if (signal.aborted || !ok) return declinedResult(cmd, signal.aborted);
  return dispatchToTab({ ...cmd, confirmed: true });
}

function declinedResult(cmd: BrowserCommand, aborted: boolean): BrowserResult {
  return {
    id: cmd.id,
    ok: false,
    op: cmd.op,
    status: "declined",
    error: aborted ? "stopped by user" : "declined by user",
  };
}

async function publishResult(
  client: LoomcycleClient,
  userId: string,
  payload: BrowserResult,
  signal: AbortSignal,
): Promise<void> {
  try {
    await client.publishChannel(RESULT_CHANNEL, {
      scope: "user",
      userId,
      payload,
      signal,
    });
  } catch (e) {
    // Aborted or transient; the agent's await times out and it can retry.
    if (!signal.aborted) {
      console.warn("[loomboard] browser.result publish failed:", e);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
