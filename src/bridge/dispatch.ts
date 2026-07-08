import { MSG_TAG, type BrowserCommand, type BrowserResult } from "./protocol";

// Send a command to the content script in the user's active tab and await its
// result. Returns a structured error result (never throws) when the page can't
// be controlled — chrome:// pages, the web store, PDFs.
//
// Self-healing: manifest-declared content scripts only inject into tabs that
// load AFTER the extension is installed/updated, so a tab opened before the last
// extension reload has no listener and the first sendMessage rejects. When that
// happens we inject the executor on demand (chrome.scripting) and retry, so the
// user doesn't have to refresh every open tab after reloading the extension.
export async function dispatchToTab(
  cmd: BrowserCommand,
): Promise<BrowserResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { id: cmd.id, ok: false, op: cmd.op, error: "no active tab" };
  }
  const tabId = tab.id;

  // Navigation unloads the content script (so it can't reply). Drive it from the
  // panel via chrome.tabs.update and wait for the load before acking, so the
  // agent's next read_page hits the loaded page.
  if (cmd.op === "navigate") {
    if (!cmd.url) {
      return { id: cmd.id, ok: false, op: cmd.op, error: "navigate requires url" };
    }
    try {
      await chrome.tabs.update(tabId, { url: cmd.url });
      await waitForTabLoad(tabId);
      return { id: cmd.id, ok: true, op: cmd.op, url: cmd.url, status: "done" };
    } catch {
      return { id: cmd.id, ok: false, op: cmd.op, error: "navigation failed" };
    }
  }

  try {
    return await sendToContentScript(tabId, cmd);
  } catch {
    // No content-script listener in this tab. Inject the executor and retry.
    // executeScript throws on a genuinely restricted page (chrome://, the web
    // store, a PDF viewer) — then it really can't be controlled.
    if (!(await injectContentScript(tabId))) {
      return uncontrollableResult(cmd);
    }
    return sendAfterInject(tabId, cmd);
  }
}

async function sendToContentScript(
  tabId: number,
  cmd: BrowserCommand,
): Promise<BrowserResult> {
  const res = (await chrome.tabs.sendMessage(tabId, {
    tag: MSG_TAG,
    command: cmd,
  })) as BrowserResult | undefined;
  return res ?? { id: cmd.id, ok: false, op: cmd.op, error: "no response from page" };
}

// Inject the manifest-declared executor content script. crxjs ships it behind a
// small loader that dynamically imports the real ES module, so we inject whatever
// content_scripts[0].js the manifest points at (stays correct across builds).
// Returns false when injection isn't possible (restricted page / no scripting
// host access) — the caller reports the page as uncontrollable.
async function injectContentScript(tabId: number): Promise<boolean> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files || files.length === 0) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false;
  }
}

// After injecting, the loader imports the executor ASYNCHRONOUSLY, so its message
// listener isn't ready the instant executeScript resolves — poll briefly until it
// answers (a local module import is fast; this is a few tens of ms in practice).
async function sendAfterInject(
  tabId: number,
  cmd: BrowserCommand,
): Promise<BrowserResult> {
  const ATTEMPTS = 6;
  const DELAY_MS = 75;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await sendToContentScript(tabId, cmd);
    } catch {
      if (i < ATTEMPTS - 1) await sleep(DELAY_MS);
    }
  }
  return uncontrollableResult(cmd);
}

function uncontrollableResult(cmd: BrowserCommand): BrowserResult {
  return {
    id: cmd.id,
    ok: false,
    op: cmd.op,
    error:
      "this page can't be controlled (no content script — a browser or restricted page?)",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
