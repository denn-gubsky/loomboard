// Wiring a data node into a state (RFC CZ "Data nodes"): a Variable, a
// Document or a Memory, dragged onto a state, is injected into that state's
// USER INPUT.
//
// There is no "data edge" in the definition. The line is DERIVED from the
// state's prompt naming the token (lib/variables.ts, lib/bindings.ts), so
// drawing one is writing that token:
//
//   ${var.name}            a variable
//   {{document:<ref>}}     a document, or one section of it
//   {{memory:<…>}}         a memory section, entry or search
//
// into `input_template` (agent / parallel / consolidator) or `prompt.input`
// (a Starter). The runtime expands it when it composes the prompt, so the
// agent receives the content and cannot decline to read it.
//
// THE HAND-OFF. An `input_template` REPLACES what the previous state handed
// over unless it names `{{thread.output}}` (loomcycle 1.103.0, #1608). So the
// first token wired into an agent-kind state that had no template is written
// AFTER that marker: the state keeps receiving the previous output (the walk's
// input, on the entry state) and gains the data. A Starter needs none of it:
// its prompt.input is always a template, with its own `{{starter.message}}`.
//
// The reverse wire, a state dragged onto a VARIABLE, sets that state's
// `capture`: its output becomes the variable (`$` binds a plain-text answer
// whole since #1607), and the variable is no longer asked for at Start.
//
// Documents and Memory are placed first and wired after, like channels: a
// placed one is only a layout position until a prompt names it.
//
// Pure: no React, no network.

import { bindingNodeId, promptText, type Binding, type BindingKind, type BindingNodeView, type PromptField } from "./bindings";
import { BINDING_HANDLE, HANDLE, VARIABLE_HANDLE } from "./flow";
import { handlerOf, patchHandler, type CanvasModel, type CanvasNode, type JsonObject } from "./model";
import type { VariableNodeView } from "./variables";
import { fieldsPatch, inputFields, startPlan } from "./inputForm";
import { THREAD_OUTPUT_SLOT } from "./validate";
import type { WireAttempt } from "./channelWiring";

/** The field that is a state's user input, or undefined for a kind that
 *  carries no prompt (and for an opaque one, whose fields are not ours). */
export function userInputField(n: CanvasNode): PromptField | undefined {
  if (n.opaque) return undefined;
  if (n.kind === "agent" || n.kind === "parallel" || n.kind === "consolidator") return "input_template";
  if (n.kind === "starter") return "prompt.input";
  return undefined;
}

export function bindingToken(b: Binding): string {
  return `{{${b.kind}:${b.ref}}}`;
}

export function variableToken(name: string): string {
  return `\${var.${name}}`;
}

export interface DataWire {
  state: string;
  field: PromptField;
  token: string;
}

/** What this connection would write, or null when it is not a data wire: the
 *  drag must start on a data node's out handle and end on a prompt-carrying
 *  state's binding handle. */
export function planDataWire(
  model: CanvasModel,
  c: WireAttempt,
  variables: readonly VariableNodeView[],
  bindings: readonly BindingNodeView[],
): DataWire | null {
  const variable = variables.find((v) => v.id === c.source);
  const binding = bindings.find((b) => b.id === c.source);
  if (!variable && !binding) return null;
  if (variable ? c.sourceHandle !== VARIABLE_HANDLE.out : c.sourceHandle !== BINDING_HANDLE.out) return null;
  if (c.targetHandle !== HANDLE.targetBind) return null;
  const n = model.nodes.find((x) => x.id === c.target);
  const field = n && userInputField(n);
  if (!n || !field) return null;
  return { state: n.id, field, token: variable ? variableToken(variable.name) : bindingToken(binding!) };
}

/** True when either end is a data node — such a drag is never a transition. */
export function touchesDataNode(
  c: WireAttempt,
  variables: readonly VariableNodeView[],
  bindings: readonly BindingNodeView[],
): boolean {
  return [...variables, ...bindings].some((v) => v.id === c.source || v.id === c.target);
}

/** How the canvas treats a drag where data nodes are concerned: a `data`
 *  wire, `invalid`, or null when it has nothing to do with them (the channel
 *  and transition rules decide). A state's binding handle takes data nodes
 *  only, so any other drag ending there is refused. */
export function dataConnection(
  model: CanvasModel,
  c: WireAttempt,
  variables: readonly VariableNodeView[],
  bindings: readonly BindingNodeView[],
): "data" | "capture" | "invalid" | null {
  if (touchesDataNode(c, variables, bindings)) {
    if (planDataWire(model, c, variables, bindings)) return "data";
    return planCaptureWire(model, c, variables) ? "capture" : "invalid";
  }
  // The data handles take data wires only: a state-to-state drag on one is
  // never a transition.
  return c.targetHandle === HANDLE.targetBind || c.sourceHandle === HANDLE.sourceVar ? "invalid" : null;
}

/** Write the token into the state's user input, on its own line at the end.
 *  A state that already names it is left as it is. An agent-kind state with
 *  no template yet gets the hand-off marker first, so it goes on receiving
 *  what the previous state handed over. */
export function applyDataWire(model: CanvasModel, w: DataWire): CanvasModel {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== w.state) return n;
      const text = promptText(n, w.field);
      if (text.includes(w.token)) return n;
      const base = text.trim() || w.field !== "input_template" ? text : THREAD_OUTPUT_SLOT;
      const next = base.trim() ? `${base.replace(/\s+$/, "")}\n${w.token}` : w.token;
      if (w.field === "input_template") return patchHandler(n, { input_template: next });
      const prompt = handlerOf(n).prompt;
      const block = typeof prompt === "object" && prompt !== null && !Array.isArray(prompt) ? (prompt as JsonObject) : {};
      return patchHandler(n, { prompt: { ...block, input: next } });
    }),
  };
}

export interface CaptureWire {
  state: string;
  variable: string;
  /** The JSONPath the state's `capture` reads. */
  path: string;
}

/** What a state's output offers a capture by default. A Starter's is the
 *  envelope of its runs' results; every other run-producing state's is its
 *  agent's answer, which `$` binds whole — as text when it is not JSON
 *  (loomcycle #1607). Undefined for a kind with no output to capture. */
export function defaultCapturePath(n: CanvasNode): string | undefined {
  if (n.opaque) return undefined;
  if (n.kind === "starter") return "$.results[0].output";
  if (n.kind === "agent" || n.kind === "parallel" || n.kind === "consolidator") return "$";
  return undefined;
}

/** A state dragged onto a variable: that state's output becomes the
 *  variable. Null unless the drag runs from a run-producing state's variable
 *  handle to a variable node's source handle. */
export function planCaptureWire(model: CanvasModel, c: WireAttempt, variables: readonly VariableNodeView[]): CaptureWire | null {
  const variable = variables.find((v) => v.id === c.target);
  if (!variable || c.sourceHandle !== HANDLE.sourceVar || c.targetHandle !== VARIABLE_HANDLE.in) return null;
  const n = model.nodes.find((x) => x.id === c.source);
  const path = n && defaultCapturePath(n);
  if (!n || !path) return null;
  return { state: n.id, variable: variable.name, path };
}

/** Set the state's `capture` for the variable, keeping its other captures —
 *  and stop asking for the variable at Start: it has a source now, and a
 *  value typed at Start would only be overwritten when the state runs. A
 *  state that already captures it keeps its own path. */
export function applyCaptureWire(model: CanvasModel, w: CaptureWire): CanvasModel {
  const front = model.nodes.find((n) => n.id === startPlan(model)?.input);
  let nodes = model.nodes;
  if (front) {
    const fields = inputFields(front);
    const kept = fields.filter((f) => f.variable !== w.variable);
    if (kept.length !== fields.length) {
      const patched = patchHandler(front, fieldsPatch(front, kept));
      nodes = nodes.map((n) => (n.id === front.id ? patched : n));
    }
  }
  return {
    ...model,
    nodes: nodes.map((n) => {
      if (n.id !== w.state) return n;
      const cur = handlerOf(n).capture;
      const capture = typeof cur === "object" && cur !== null && !Array.isArray(cur) ? (cur as JsonObject) : {};
      if (typeof capture[w.variable] === "string") return n;
      return patchHandler(n, { capture: { ...capture, [w.variable]: w.path } });
    }),
  };
}

const REF_OK: Record<BindingKind, RegExp> = {
  // docinject.go's ref alphabet (without ${…}, which a placed node cannot be
  // asked for by name), and inject.go's memory forms.
  document: /^[A-Za-z0-9_./#: @+-]{1,512}$/,
  memory: /^(?:[a-z_]+|(?:key|search):[A-Za-z0-9_./#:@+\- ]+)$/,
};

/** Why a ref cannot be placed, or undefined when it can. */
export function bindingRefError(kind: BindingKind, ref: string): string | undefined {
  if (!ref.trim()) return "a name is required";
  if (!REF_OK[kind].test(ref.trim())) {
    return kind === "document"
      ? "a document is named by its path or id, optionally with #Heading"
      : "a memory is a section (e.g. core_blocks), key:<key>, or search:<query>";
  }
  return undefined;
}

/** Place a Document or Memory node nothing reads yet. All that is written is
 *  a layout position; wiring it writes the token. One already drawn is left
 *  where it is. */
export function placeBinding(
  model: CanvasModel,
  views: readonly BindingNodeView[],
  kind: BindingKind,
  ref: string,
): { model: CanvasModel; id: string } {
  const b = { kind, ref: ref.trim() };
  const id = bindingNodeId(b);
  if (bindingRefError(kind, b.ref) || views.some((v) => v.id === id)) return { model, id };
  const ys = model.nodes.map((n) => n.position.y);
  const y = (ys.length ? Math.max(...ys) : 0) + 170;
  let x = 0;
  while (views.some((v) => Math.abs(v.position.x - x) < 250 && Math.abs(v.position.y - y) < 100)) x += 250;
  return {
    model: {
      ...model,
      layoutDirty: true,
      derivedPositions: { ...(model.derivedPositions ?? {}), [id]: { x, y: Math.round(y) } },
      channelsRemoved: model.channelsRemoved?.filter((k) => k !== id),
    },
    id,
  };
}

/** Remove a placed Document or Memory node nothing reads. One a prompt names
 *  is left alone: it exists because of that prompt. */
export function removeBinding(model: CanvasModel, view: BindingNodeView): CanvasModel {
  if (view.readers.length) return model;
  const positions = { ...(model.derivedPositions ?? {}) };
  delete positions[view.id];
  return {
    ...model,
    layoutDirty: true,
    derivedPositions: positions,
    // The model's list of derived layout keys to drop on save (named for the
    // channels it was first used for).
    channelsRemoved: [...new Set([...(model.channelsRemoved ?? []), view.id])],
  };
}
