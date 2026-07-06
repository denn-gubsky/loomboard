import {
  MSG_TAG,
  type BrowserCommand,
  type BrowserResult,
} from "../../src/bridge/protocol";
import { buildSnapshot } from "./snapshot";
import { resolveRef } from "./refmap";

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
    case "fill":
      return fill(cmd);
    case "click":
      return click(cmd);
    default:
      return {
        id: cmd.id,
        ok: false,
        op: cmd.op,
        error: `unsupported op: ${cmd.op}`,
      };
  }
}

// A ref that no longer resolves (page mutated / navigated). Return a fresh
// snapshot so the agent can retry against current refs.
function staleResult(cmd: BrowserCommand): BrowserResult {
  return {
    id: cmd.id,
    ok: false,
    op: cmd.op,
    error: "stale_ref",
    snapshot: buildSnapshot(),
  };
}

// True for password / payment fields (and clicks on a form containing them).
// A sensitive target always requires the user's confirmation, even in autonomous
// mode — the loop re-issues the command with `confirmed:true` after approval.
function isSensitiveInput(el: Element | null): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === "password") return true;
  const ac = (el.autocomplete || "").toLowerCase();
  if (ac.startsWith("cc-") || ac === "current-password" || ac === "new-password") {
    return true;
  }
  const hint = `${el.name} ${el.id}`.toLowerCase();
  return /pass|card|cvv|cvc|ccnum|credit/.test(hint);
}

function isSensitiveTarget(el: Element): boolean {
  if (isSensitiveInput(el)) return true;
  const form = (el as HTMLElement).closest?.("form");
  if (form) {
    for (const inp of form.querySelectorAll("input")) {
      if (isSensitiveInput(inp)) return true;
    }
  }
  return false;
}

// Set an input/textarea value via the native setter so React-controlled inputs
// observe the change (React overrides the value setter to track state).
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

// Sensitive targets need explicit confirmation even in autonomous mode.
function needsConfirmResult(cmd: BrowserCommand): BrowserResult {
  return {
    id: cmd.id,
    ok: false,
    op: cmd.op,
    status: "needs_confirm",
    error: "sensitive field — confirmation required",
  };
}

function fill(cmd: BrowserCommand): BrowserResult {
  const el = resolveRef(cmd.ref ?? "");
  if (!el) return staleResult(cmd);
  if (!cmd.confirmed && isSensitiveTarget(el)) return needsConfirmResult(cmd);
  const value = cmd.value ?? "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el instanceof HTMLSelectElement) {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    return { id: cmd.id, ok: false, op: cmd.op, error: "element is not fillable" };
  }
  return { id: cmd.id, ok: true, op: cmd.op, snapshot: buildSnapshot() };
}

function click(cmd: BrowserCommand): BrowserResult {
  const el = resolveRef(cmd.ref ?? "");
  if (!el) return staleResult(cmd);
  if (!cmd.confirmed && isSensitiveTarget(el)) return needsConfirmResult(cmd);
  if (el instanceof HTMLElement) el.click();
  else (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // A click may navigate; the snapshot is best-effort (may be pre-navigation).
  return { id: cmd.id, ok: true, op: cmd.op, snapshot: buildSnapshot() };
}
