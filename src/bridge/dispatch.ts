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
  // Navigation unloads the content script (so it can't reply). Drive it from the
  // panel via chrome.tabs.update and wait for the load before acking, so the
  // agent's next read_page hits the loaded page.
  if (cmd.op === "navigate") {
    if (!cmd.url) {
      return { id: cmd.id, ok: false, op: cmd.op, error: "navigate requires url" };
    }
    try {
      await chrome.tabs.update(tab.id, { url: cmd.url });
      await waitForTabLoad(tab.id);
      return { id: cmd.id, ok: true, op: cmd.op, url: cmd.url, status: "done" };
    } catch {
      return { id: cmd.id, ok: false, op: cmd.op, error: "navigation failed" };
    }
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

// Resolve when the tab finishes loading (or a timeout, so a hung load never
// wedges the bridge).
function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
