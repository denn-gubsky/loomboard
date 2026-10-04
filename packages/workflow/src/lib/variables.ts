// Variable nodes (RFC CZ "Data nodes"): a team's ${var.*} drawn as nodes — a
// named value with a SOURCE, not a step in the walk.
//
// DERIVED, like channel and binding nodes: a variable node exists because the
// definition sets or reads the variable. Where its value comes from decides
// what it is in the definition:
//
//   - asked at Start: a field of the team's start form bound to the variable
//     (an Input state's `capture`, or an input Starter's `binds`);
//   - captured: `capture` (or a channel Starter's `binds`) on the state whose
//     output or message it is read from;
//   - set: an assignment on a `vars` state.
//
// A variable some prompt reads and nothing sets expands to EMPTY at run time.
// That is the case the canvas exists to catch: it is flagged, and
// `askAtStart` turns it into a form field, so Start asks for it.
//
// Pure: no React, no network.

import { promptFields, promptText, type PromptField } from "./bindings";
import { fieldsPatch, inputFields, placeInput, startPlan } from "./inputForm";
import {
  handlerOf,
  patchHandler,
  storedDerivedPosition,
  VARIABLE_LAYOUT_PREFIX,
  type CanvasModel,
  type JsonObject,
  type XY,
} from "./model";
import type { Finding } from "./validate";

export type VariableSource =
  /** A field of the start form: the person starting the team is asked. */
  | { kind: "start"; state: string; field: string }
  /** Read from a state's output (or a Starter's message) by JSONPath. */
  | { kind: "capture"; state: string; path: string }
  /** Assigned on a `vars` state. */
  | { kind: "set"; state: string };

export interface VariableNodeView {
  /** `var:<name>` — also its layout key. */
  id: string;
  name: string;
  sources: VariableSource[];
  /** The states whose prompts read it, each with the field. */
  readers: { state: string; field: PromptField }[];
  position: XY;
  placed: boolean;
}

export function variableNodeId(name: string): string {
  return `${VARIABLE_LAYOUT_PREFIX}${name}`;
}

/** varinject.go's token, for variables only: `${var.name}` or `${var.name:-default}`. */
const VAR_REF = /\$\{var\.([a-zA-Z0-9_-]{1,64})(?::-[^{}]*)?\}/g;

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Below the binding row, which sits below the states. */
export const VARIABLE_DROP = 300;
export const VARIABLE_CLEARANCE = { x: 230, y: 90 };

export function variableNodes(model: CanvasModel): VariableNodeView[] {
  const sources = new Map<string, VariableSource[]>();
  const readers = new Map<string, { state: string; field: PromptField }[]>();
  const order: string[] = [];
  const touch = (name: string) => {
    if (!sources.has(name)) {
      sources.set(name, []);
      readers.set(name, []);
      order.push(name);
    }
  };

  // The start form's bound fields: the front door's own mapping.
  const front = model.nodes.find((n) => n.id === startPlan(model)?.input);
  const asked = new Set<string>();
  if (front) {
    for (const f of inputFields(front)) {
      if (!f.variable) continue;
      touch(f.variable);
      asked.add(f.variable);
      sources.get(f.variable)!.push({ kind: "start", state: front.id, field: f.name });
    }
  }

  for (const n of model.nodes) {
    if (n.opaque) continue;
    const h = handlerOf(n);
    for (const key of n.kind === "starter" ? ["binds", "capture"] : ["capture"]) {
      const map = h[key];
      if (!isObj(map)) continue;
      for (const [name, path] of Object.entries(map)) {
        // The front door's form fields are already "asked at Start".
        if (n.id === front?.id && asked.has(name) && sources.get(name)!.some((s) => s.kind === "start")) {
          const formKey = n.kind === "starter" ? "binds" : "capture";
          if (key === formKey) continue;
        }
        touch(name);
        sources.get(name)!.push({ kind: "capture", state: n.id, path: typeof path === "string" ? path : "" });
      }
    }
    if (n.kind === "vars" && isObj(h.set)) {
      for (const name of Object.keys(h.set)) {
        touch(name);
        sources.get(name)!.push({ kind: "set", state: n.id });
      }
    }
    for (const field of promptFields(n.kind)) {
      for (const m of promptText(n, field).matchAll(VAR_REF)) {
        touch(m[1]);
        const list = readers.get(m[1])!;
        if (!list.some((r) => r.state === n.id && r.field === field)) list.push({ state: n.id, field });
      }
    }
  }

  const pos = new Map(model.nodes.map((n) => [n.id, n.position]));
  const taken: XY[] = [];
  const overlaps = (p: XY) =>
    taken.some((t) => Math.abs(t.x - p.x) < VARIABLE_CLEARANCE.x && Math.abs(t.y - p.y) < VARIABLE_CLEARANCE.y);
  return order.map((name) => {
    const id = variableNodeId(name);
    const stored = storedDerivedPosition(model, id);
    let position = stored;
    if (!position) {
      // Under what it touches: its readers, else its sources.
      const near = (readers.get(name)!.length ? readers.get(name)! : sources.get(name)!)
        .map((r) => pos.get(r.state))
        .filter((p): p is XY => !!p);
      const x = near.reduce((a, p) => a + p.x, 0) / Math.max(1, near.length);
      const y = near.length ? Math.max(...near.map((p) => p.y)) + VARIABLE_DROP : VARIABLE_DROP;
      position = { x: Math.round(x), y: Math.round(y) };
      while (overlaps(position)) position = { x: position.x + VARIABLE_CLEARANCE.x, y: position.y };
    }
    taken.push(position);
    return { id, name, sources: sources.get(name)!, readers: readers.get(name)!, position, placed: !!stored };
  });
}

/** A variable a prompt reads and nothing sets: it expands to empty, silently.
 *  `info`, because the runtime accepts it — a `:-default` may be the intent. */
export function variableFindings(views: readonly VariableNodeView[]): Finding[] {
  return views
    .filter((v) => v.sources.length === 0)
    .map((v) => ({
      level: "info" as const,
      nodeId: v.readers[0]?.state,
      message:
        `\${var.${v.name}} is read by ${[...new Set(v.readers.map((r) => JSON.stringify(r.state)))].join(", ")} ` +
        "but nothing sets it — it expands to empty. Select the variable and choose Ask at Start, or set it.",
    }));
}

/** The first free `var<N>` name. */
export function nextVariableName(views: readonly VariableNodeView[]): string {
  const used = new Set(views.map((v) => v.name));
  for (let i = 1; ; i++) if (!used.has(`var${i}`)) return `var${i}`;
}

/** Make `name` a field of the team's start form, bound to the variable, so
 *  Start asks for it — and every caller must send it, since the runtime checks
 *  a walk's input against the form's schema. A team with no front door gets an
 *  Input node as its entry (`inputRaw`, a fresh input state). A variable the
 *  form already asks for is left as it is. */
export function askAtStart(
  model: CanvasModel,
  name: string,
  inputRaw: JsonObject,
  derived: readonly XY[] = [],
): { model: CanvasModel; front: string } {
  const placed = placeInput(model, inputRaw, derived);
  const front = placed.model.nodes.find((n) => n.id === placed.id)!;
  const fields = inputFields(front);
  if (fields.some((f) => f.variable === name)) return { model: placed.model, front: front.id };
  // A field of that name may exist unbound: bind it rather than add a twin.
  const next = fields.some((f) => f.name === name)
    ? fields.map((f) => (f.name === name ? { ...f, variable: name } : f))
    : [...fields, { name, type: "string" as const, required: true, variable: name }];
  const patched = patchHandler(front, fieldsPatch(front, next));
  return {
    model: { ...placed.model, nodes: placed.model.nodes.map((n) => (n.id === front.id ? patched : n)) },
    front: front.id,
  };
}
