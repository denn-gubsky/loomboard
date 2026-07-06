import { MSG_TAG, type BrowserCommand, type BrowserResult } from "./protocol";

// Send a command to the content script in the user's active tab and await its
// result. Returns a structured error result (never throws) when no content
// script is reachable — chrome:// pages, the web store, PDFs, or a tab where the
// script hasn't loaded.
export async function dispatchToTab(
  cmd: BrowserCommand,
): Promise<BrowserResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { id: cmd.id, ok: false, op: cmd.op, error: "no active tab" };
  }
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, {
      tag: MSG_TAG,
      command: cmd,
    })) as BrowserResult | undefined;
    return (
      res ?? { id: cmd.id, ok: false, op: cmd.op, error: "no response from page" }
    );
  } catch {
    return {
      id: cmd.id,
      ok: false,
      op: cmd.op,
      error:
        "this page can't be controlled (no content script — a browser or restricted page?)",
    };
  }
}
