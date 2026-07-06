// Shared protocol for the browser bridge. The agent publishes a COMMAND to
// CMD_CHANNEL and awaits the matching RESULT on RESULT_CHANNEL (both declared
// scope:user on loomcycle). The extension's channel loop is the mirror image.
// Keep these shapes in sync with the system prompt (systemPrompt.ts), which
// describes the same protocol to the agent in prose.

/** The browser-assistant agent (pinned; the panel hides the agent picker). */
export const ASSISTANT_AGENT = "chrome-assistant";

/** Agent → extension: actuation commands. */
export const CMD_CHANNEL = "browser.cmd";
/** Extension → agent: command results (incl. post-action page snapshot). */
export const RESULT_CHANNEL = "browser.result";

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
  status?: "declined" | "timeout" | "pending" | "done";
}
