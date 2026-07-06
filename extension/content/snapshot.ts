import type { PageSnapshot, SnapshotRef } from "../../src/bridge/protocol";
import { assignRef, resetRefs } from "./refmap";

// Build a compact, accessibility-flavored snapshot of the page's actionable
// elements, each with a stable `ref` the agent targets (the Playwright /
// chrome-devtools-MCP pattern — never CSS selectors). Refs are re-minted on each
// call; the executor returns a fresh snapshot after every action.

const INTERACTIVE =
  "a[href], button, input, textarea, select, [role='button']," +
  " [role='link'], [role='textbox'], [role='checkbox'], [role='radio']," +
  " [contenteditable='true'], [onclick]";
const MAX_REFS = 200;
const MAX_TEXT = 8000;

function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.hidden) return false;
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(he);
  return style.visibility !== "hidden" && style.display !== "none";
}

function accessibleName(el: Element): string {
  const he = el as HTMLElement;
  const attrs = ["aria-label", "alt", "title"];
  for (const a of attrs) {
    const v = he.getAttribute(a);
    if (v && v.trim()) return v.trim().slice(0, 120);
  }
  const text = (he.innerText || he.textContent || "").trim();
  if (text) return text.slice(0, 120);
  const ph = he.getAttribute("placeholder");
  if (ph && ph.trim()) return ph.trim().slice(0, 120);
  const name = he.getAttribute("name");
  return name ? name.trim().slice(0, 120) : "";
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const t = (el as HTMLInputElement).type;
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button" || t === "reset") return "button";
    return "textbox";
  }
  return tag;
}

export function buildSnapshot(): PageSnapshot {
  resetRefs();
  const refs: SnapshotRef[] = [];
  const els = document.querySelectorAll(INTERACTIVE);
  for (const el of els) {
    if (refs.length >= MAX_REFS) break;
    if (!isVisible(el)) continue;
    const ref = assignRef(el);
    const input = el as HTMLInputElement;
    const value =
      typeof input.value === "string" && input.value
        ? input.value.slice(0, 200)
        : undefined;
    const placeholder = el.getAttribute("placeholder") || undefined;
    refs.push({ ref, role: roleOf(el), name: accessibleName(el), tag: el.tagName.toLowerCase(), value, placeholder });
  }
  const text = (document.body?.innerText ?? "").slice(0, MAX_TEXT);
  return { url: location.href, title: document.title, refs, text };
}
