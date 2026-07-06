import {
  MSG_TAG,
  type BrowserCommand,
  type BrowserResult,
} from "../../src/bridge/protocol";
import { buildSnapshot } from "./snapshot";

// Content script: executes browser commands in the page and replies with a
// result. The panel sends { tag: MSG_TAG, command } via chrome.tabs.sendMessage.
// M3 handles the read-only ops (read_page, get_selection); mutating ops
// (fill/click/navigate) are added in M4.

chrome.runtime.onMessage.addListener(
  (msg: unknown, _sender, sendResponse: (r: BrowserResult) => void) => {
    if (
      !msg ||
      typeof msg !== "object" ||
      (msg as { tag?: unknown }).tag !== MSG_TAG
    ) {
      return; // not ours — let other listeners handle it
    }
    const cmd = (msg as { command: BrowserCommand }).command;
    handle(cmd)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          id: cmd?.id ?? "",
          ok: false,
          op: cmd?.op ?? "unknown",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    return true; // async sendResponse
  },
);

async function handle(cmd: BrowserCommand): Promise<BrowserResult> {
  switch (cmd.op) {
    case "read_page":
      return {
        id: cmd.id,
        ok: true,
        op: cmd.op,
        snapshot: buildSnapshot(),
        url: location.href,
        title: document.title,
      };
    case "get_selection":
      return {
        id: cmd.id,
        ok: true,
        op: cmd.op,
        text: (window.getSelection?.()?.toString() ?? "").slice(0, 8000),
      };
    default:
      return {
        id: cmd.id,
        ok: false,
        op: cmd.op,
        error: `unsupported op: ${cmd.op}`,
      };
  }
}
