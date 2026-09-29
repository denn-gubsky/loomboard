// Binding nodes (RFC CZ P3): the Documents and Memory a team's prompts pull
// in, drawn as nodes feeding the states that read them.
//
// A binding is a `{{document:…}}` or `{{memory:…}}` placeholder in a state's
// prompt. The RUNTIME resolves it into the prompt (RFC CY Decision 5), so the
// agent receives the content and cannot decline to read it — which is why a
// binding is drawn as data flowing INTO the state, not as a tool it may call.
//
// DERIVED, like channel nodes: a binding node exists because a prompt names
// it. The only thing persisted is where it is drawn, in `layout.nodes` under a
// `binding:` key.
//
// The grammar is mirrored from loomcycle at v1.100.0 — internal/memory/
// inject.go (combinedPlaceholderRe and its order), docinject.go,
// meminject_widened.go, toolinject*.go, varinject.go — because a canvas that
// drew a placeholder the runtime does not expand, or missed one it does, would
// misdescribe what the agent is sent. Order matters: the families are one
// alternation tried leftmost-first, so `{{memory:key:x}}` is the sub-form and
// never the plain variant.
//
// Pure: no React, no network.

import type { CanvasModel, CanvasNode, XY } from "./model";
import type { Finding } from "./validate";
import { BINDING_LAYOUT_PREFIX, handlerOf } from "./model";

/** varinject.go varTokenPattern — a complete ${…} token, allowed INSIDE a ref. */
const VAR_TOKEN = String.raw`\$\{(?:var|now|team)\.[a-zA-Z0-9_-]{1,64}(?::-[^{}]*)?\}`;

// The five families, in combinedPlaceholderRe's order. Group 1 of each is the
// optional escaping backslash.
const MEM_SUB = String.raw`(\\?)\{\{\s*memory\s*:\s*(key|search)\s*:\s*((?:[A-Za-z0-9_./#:@+\- ]|${VAR_TOKEN})+)\s*\}\}`;
const MEM_PLAIN = String.raw`(\\?)\{\{\s*memory\s*:\s*([a-z_]+)\s*\}\}`;
const TOOL_ARG = String.raw`(\\?)\{\{\s*tool\s*:\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*((?:[A-Za-z0-9_./#:@+\-?=&%~,;!'() ]|${VAR_TOKEN})+)\s*\}\}`;
const TOOL = String.raw`(\\?)\{\{\s*tool\s*:\s*([A-Za-z][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z0-9_]+)?)\s*\}\}`;
const DOC = String.raw`(\\?)\{\{\s*document\s*:\s*((?:[A-Za-z0-9_./#: @+-]|${VAR_TOKEN})+)\s*\}\}`;

/** `(?i)` in Go; `i` here. Group indices: memSub 1–3, memPlain 4–5,
 *  toolArg 6–8, tool 9–10, doc 11–12. */
function combined(): RegExp {
  return new RegExp(`${MEM_SUB}|${MEM_PLAIN}|${TOOL_ARG}|${TOOL}|${DOC}`, "gi");
}

/** inject.go knownVariants. In a TeamDef prompt an unknown variant is NOT
 *  refused — boot validation covers operator yaml only — so it renders
 *  silently EMPTY at run time. The canvas flags it for exactly that reason. */
export const MEMORY_VARIANTS = [
  "core_blocks",
  "user_info",
  "tenant_info",
  "ontology",
  "search_request",
  "recalled_context",
  "consolidation_bands",
] as const;

/** docinject.go MaxRefBytes — a longer ref does not parse. */
const MAX_REF_BYTES = 512;

export type BindingKind = "document" | "memory";

export interface Binding {
  kind: BindingKind;
  /** document: the ref as written (path or id, optional #heading).
   *  memory: `key:<k>`, `search:<q>`, or a section variant. */
  ref: string;
}

export interface BindingUse extends Binding {
  state: string;
  field: PromptField;
}

/** Where a state's prompt text lives, by kind. teamgraph refuses a Starter's
 *  `prompt` block on any other kind, and the others' system_prompt /
 *  input_template on a Starter. */
export type PromptField = "system_prompt" | "input_template" | "prompt.system" | "prompt.input";

/** Empty for every other kind — including an opaque (unknown) one, whose
 *  fields mean whatever a newer runtime says they mean, so none of them is read
 *  as a prompt here (decision 3). */
export function promptFields(kind: string): PromptField[] {
  if (kind === "agent" || kind === "parallel" || kind === "consolidator") {
    return ["system_prompt", "input_template"];
  }
  if (kind === "starter") return ["prompt.system", "prompt.input"];
  return [];
}

export function promptText(n: CanvasNode, field: PromptField): string {
  const h = handlerOf(n);
  const read = (v: unknown) => (typeof v === "string" ? v : "");
  if (field === "prompt.system" || field === "prompt.input") {
    const p = h.prompt;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return "";
    return read((p as Record<string, unknown>)[field === "prompt.system" ? "system" : "input"]);
  }
  return read(h[field]);
}

/** Every UNESCAPED document / memory placeholder in `text`, in order.
 *  Tool placeholders are matched (so they cannot be mis-read as another
 *  family) and skipped: a tool is something the runtime CALLS, not data. */
export function scanBindings(text: string): Binding[] {
  const out: Binding[] = [];
  for (const m of text.matchAll(combined())) {
    if (m[1] !== undefined) {
      if (m[1] === "\\") continue;
      out.push({ kind: "memory", ref: `${m[2].toLowerCase()}:${m[3].trim()}` });
    } else if (m[4] !== undefined) {
      if (m[4] === "\\") continue;
      out.push({ kind: "memory", ref: m[5].toLowerCase() });
    } else if (m[11] !== undefined) {
      if (m[11] === "\\") continue;
      const ref = m[12].trim();
      // ParseDocRef: over-long, or an empty path before '#', does not parse.
      const path = ref.split("#")[0].trim();
      if (new TextEncoder().encode(m[12]).length > MAX_REF_BYTES || !path) continue;
      out.push({ kind: "document", ref });
    }
    // m[6..10]: the tool families — deliberately not bindings.
  }
  return out;
}

/** What the agent actually receives for a document ref (RFC CY Amendment B):
 *  a whole document by PATH renders a directive naming the tool and path —
 *  the agent reads it live — while a #heading or an id is inlined. The node
 *  face must say which, so a directive is not mistaken for missing content. */
export function documentDelivery(ref: string): "inlined" | "directive" {
  const [path, heading] = ref.split("#").map((s) => s.trim());
  return path.startsWith("/") && !heading ? "directive" : "inlined";
}

export interface BindingNodeView extends Binding {
  /** `binding:<kind>:<ref>` — also its layout key. */
  id: string;
  /** The states whose prompts name it, each with the field. */
  readers: { state: string; field: PromptField }[];
  position: XY;
  placed: boolean;
  /** document: inlined or directive. */
  delivery?: "inlined" | "directive";
  /** memory: a section variant this runtime does not know — renders empty. */
  unknownVariant?: boolean;
  /** The ref carries ${…}: its value is decided per run, so what it names is
   *  not knowable on the canvas. */
  templated: boolean;
}

export function bindingNodeId(b: Binding): string {
  return `${BINDING_LAYOUT_PREFIX}${b.kind}:${b.ref}`;
}

/** How far below the states they feed unplaced bindings sit — channels go
 *  above (C9's top handles); bindings go below, into their own handle. */
export const BINDING_DROP = 170;
export const BINDING_CLEARANCE = { x: 250, y: 100 };

function isXY(v: unknown): v is XY {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.x === "number" && typeof p.y === "number";
}

function storedPosition(model: CanvasModel, id: string): XY | undefined {
  const moved = model.derivedPositions?.[id];
  if (moved) return moved;
  const layout = model.source.layout;
  const nodes =
    typeof layout === "object" && layout !== null && !Array.isArray(layout)
      ? (layout as Record<string, unknown>).nodes
      : undefined;
  if (typeof nodes !== "object" || nodes === null) return undefined;
  const p = (nodes as Record<string, unknown>)[id];
  return isXY(p) ? { x: p.x, y: p.y } : undefined;
}

/** Every binding the model's prompts name, with who reads it. */
export function bindingUses(model: CanvasModel): BindingUse[] {
  const out: BindingUse[] = [];
  for (const n of model.nodes) {
    for (const field of promptFields(n.kind)) {
      for (const b of scanBindings(promptText(n, field))) out.push({ ...b, state: n.id, field });
    }
  }
  return out;
}

export function bindingNodes(model: CanvasModel): BindingNodeView[] {
  const byId = new Map<string, { b: Binding; readers: { state: string; field: PromptField }[] }>();
  for (const u of bindingUses(model)) {
    const id = bindingNodeId(u);
    const e = byId.get(id) ?? { b: { kind: u.kind, ref: u.ref }, readers: [] };
    if (!e.readers.some((r) => r.state === u.state && r.field === u.field)) {
      e.readers.push({ state: u.state, field: u.field });
    }
    byId.set(id, e);
  }

  const pos = new Map(model.nodes.map((n) => [n.id, n.position]));
  const taken: XY[] = [];
  const overlaps = (p: XY) =>
    taken.some((t) => Math.abs(t.x - p.x) < BINDING_CLEARANCE.x && Math.abs(t.y - p.y) < BINDING_CLEARANCE.y);
  const out: BindingNodeView[] = [];
  for (const id of [...byId.keys()].sort()) {
    const { b, readers } = byId.get(id)!;
    const stored = storedPosition(model, id);
    let position = stored;
    if (!position) {
      const pts = readers.map((r) => pos.get(r.state)).filter(isXY);
      const x = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
      const y = Math.max(...pts.map((p) => p.y)) + BINDING_DROP;
      position = { x: Math.round(x), y: Math.round(Number.isFinite(y) ? y : BINDING_DROP) };
      while (overlaps(position)) position = { x: position.x + BINDING_CLEARANCE.x, y: position.y };
    }
    taken.push(position);
    out.push({
      ...b,
      id,
      readers,
      position,
      placed: !!stored,
      templated: /\$\{/.test(b.ref),
      ...(b.kind === "document" ? { delivery: documentDelivery(b.ref) } : {}),
      ...(b.kind === "memory" && !b.ref.includes(":")
        ? { unknownVariant: !(MEMORY_VARIANTS as readonly string[]).includes(b.ref) }
        : {}),
    });
  }
  return out;
}

/** Findings the canvas raises about bindings. Not part of validateModel: the
 *  runtime refuses none of these on save — which is the problem. An unknown
 *  memory section in a TeamDef prompt renders EMPTY at run time (boot
 *  validation covers operator yaml only), so it is a silent failure worth
 *  saying out loud, at `info` because the save is not blocked. */
export function bindingFindings(model: CanvasModel): Finding[] {
  const out: Finding[] = [];
  for (const u of bindingUses(model)) {
    if (u.kind !== "memory" || u.ref.includes(":")) continue;
    if ((MEMORY_VARIANTS as readonly string[]).includes(u.ref)) continue;
    out.push({
      level: "info",
      nodeId: u.state,
      message:
        `state ${JSON.stringify(u.state)} ${u.field} names {{memory:${u.ref}}}, which this runtime ` +
        `does not know — it renders EMPTY. Known sections: ${MEMORY_VARIANTS.join(", ")}`,
    });
  }
  return out;
}
