// Internal command/result shapes for the browser bridge. The agent invokes a
// client-tool (`client__browser_<op>`); loomcycle routes it to this extension's
// client-tool host (clientToolHost.ts), which maps the invocation to one of
// these commands, runs it in the active tab, and returns the result as the
// tool's JSON output. These shapes are internal (panel ↔ content script) — the
// agent-facing tool names + input schemas live in clientToolHost.ts.

/** The browser-assistant agent (pinned; the panel hides the agent picker). */
export const ASSISTANT_AGENT = "chrome-assistant";

/** Prefix on the client-tool names this extension registers: `browser_<op>`.
 *  Agents call them as `client__browser_<op>` (the runtime adds `client__`).
 *  Underscores only — loomcycle requires wire-safe (`[a-zA-Z0-9_-]`) bare names
 *  so `client__` + name stays a valid LLM function-name identifier. */
export const BROWSER_TOOL_PREFIX = "browser_";

/** Tag on chrome.runtime messages between the panel and the content script, so
 *  the executor ignores unrelated extension messages. */
export const MSG_TAG = "loomboard/browser-cmd";

export type BrowserOp =
  | "read_page"
  | "get_selection"
  | "fill"
  | "click"
  | "navigate";

/** Ops that change the page — gated by the confirm/approve UX. */
const MUTATING_OPS: ReadonlySet<string> = new Set(["fill", "click", "navigate"]);
export function isMutating(op: string): boolean {
  return MUTATING_OPS.has(op);
}

export interface BrowserCommand {
  /** Correlation id (agent-generated); the result echoes it. */
  id: string;
  op: BrowserOp;
  /** Target element ref from the latest snapshot (fill/click). */
  ref?: string;
  /** Text to fill. */
  value?: string;
  /** URL to navigate to. */
  url?: string;
  /** One-line rationale shown to the user in the confirm bar. */
  reason?: string;
  /** Set by the loop after the user approved this action — lets the executor
   *  proceed past the sensitive-field guard (password / payment fields). */
  confirmed?: boolean;
}

export interface SnapshotRef {
  ref: string;
  role: string;
  name: string;
  tag: string;
  value?: string;
  placeholder?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  refs: SnapshotRef[];
  text: string;
}

export interface BrowserResult {
  /** Echoes the command id. */
  id: string;
  ok: boolean;
  op: BrowserOp | string;
  /** Fresh snapshot after read_page and after any mutation. */
  snapshot?: PageSnapshot;
  text?: string;
  url?: string;
  title?: string;
  error?: string;
  status?: "declined" | "done" | "needs_confirm";
}
