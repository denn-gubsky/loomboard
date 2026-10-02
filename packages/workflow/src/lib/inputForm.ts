// The Input node: a team's front door, as a form (RFC CZ "The Input node").
//
// The node IS the definition's `input` state — the walk's entry. Its `schema`
// is the form a client renders (the runtime carries it, never interprets it),
// and its `capture` maps the form's fields into `${var.*}` for the rest of the
// team: the runtime parses the threaded input as JSON and binds each JSONPath
// (loomcycle teamrun `captured`), so this works today with no new feature.
//
// A Starter whose source is the walk's input (loomcycle #1579) is the same
// front door in one node: its `schema` is the form, and its `binds` — not
// `capture` — map the form's fields into variables. Start just runs: the
// Starter takes the input itself, so nothing is published anywhere.
//
// What Start does for an Input STATE depends on what it leads to:
//   - an agent / parallel state: runTeam({input}) and nothing else;
//   - a Starter reading a channel: the Starter only reads its channel, so the
//     form must be ON that channel first. Until loomcycle ships a Starter that
//     takes the walk's input (G15 Ask A), the canvas publishes the form there
//     from the browser, then runs — the same two calls the publish composer
//     makes. The plan below names the channel so both the button and the
//     graph can say so.
//
// Pickers come from `x-loomcycle-picker` on a property (G15 Ask C, the name
// loomcycle adopted): `document` lists documents, `chunk` lists the chunks of
// the document chosen in a sibling field. The value stays a plain id, so a
// headless caller just sends ids.
//
// Pure: no React, no network.

import { handlerChannels, handlerOf, type CanvasModel, type CanvasNode, type Json, type JsonObject, type XY } from "./model";
import { isInputStarter } from "./validate";

export const PICKER_KEY = "x-loomcycle-picker";

export type FieldType = "string" | "number" | "integer" | "boolean";
const FIELD_TYPES: readonly FieldType[] = ["string", "number", "integer", "boolean"];

export interface PickerSpec {
  kind: "document" | "chunk";
  /** Which store to browse; the runtime's default is the user's. */
  scope?: "user" | "tenant";
  /** document pickers: list only documents at or under this path. */
  underPath?: string;
  /** chunk pickers: the sibling field holding the document id. */
  document?: string;
  /** chunk pickers: 1 = top-level sections only. */
  depth?: number;
}

export interface InputField {
  name: string;
  title?: string;
  description?: string;
  type: FieldType;
  required: boolean;
  picker?: PickerSpec;
  /** The variable this field binds through `capture`, when it is bound. */
  variable?: string;
}

/** Variable and field names share the runtime's grammar. */
export const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readPicker(v: unknown): PickerSpec | undefined {
  if (!isObj(v) || (v.kind !== "document" && v.kind !== "chunk")) return undefined;
  const p: PickerSpec = { kind: v.kind };
  if (v.scope === "user" || v.scope === "tenant") p.scope = v.scope;
  if (typeof v.under_path === "string" && v.under_path) p.underPath = v.under_path;
  if (typeof v.document === "string" && v.document) p.document = v.document;
  if (typeof v.depth === "number" && v.depth > 0) p.depth = v.depth;
  return p;
}

function writePicker(p: PickerSpec): JsonObject {
  return {
    kind: p.kind,
    ...(p.scope ? { scope: p.scope } : {}),
    ...(p.underPath ? { under_path: p.underPath } : {}),
    ...(p.document ? { document: p.document } : {}),
    ...(p.depth ? { depth: p.depth } : {}),
  };
}

/** The field a capture path reads, when it is the plain `$.<field>` form the
 *  form editor writes. Anything else is the author's own capture, kept as is. */
function capturedField(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const m = /^\$\.([a-zA-Z0-9_-]{1,64})$/.exec(path);
  return m?.[1];
}

/** Which handler map binds the form's fields to variables: a Starter's
 *  `binds` (over its item), an input state's `capture` (over its output). */
function mappingKey(n: CanvasNode): "binds" | "capture" {
  return n.kind === "starter" ? "binds" : "capture";
}

/** The form an `input` state — or an input-sourced Starter — declares, with
 *  each field's variable. */
export function inputFields(n: CanvasNode): InputField[] {
  const h = handlerOf(n);
  const schema = isObj(h.schema) ? h.schema : {};
  const props = isObj(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  const mapping = h[mappingKey(n)];
  const capture = isObj(mapping) ? mapping : {};
  const variableOf = new Map<string, string>();
  for (const [variable, path] of Object.entries(capture)) {
    const field = capturedField(path);
    if (field && !variableOf.has(field)) variableOf.set(field, variable);
  }
  return Object.entries(props).map(([name, raw]) => {
    const p = isObj(raw) ? raw : {};
    const type = FIELD_TYPES.includes(p.type as FieldType) ? (p.type as FieldType) : "string";
    return {
      name,
      ...(typeof p.title === "string" && p.title ? { title: p.title } : {}),
      ...(typeof p.description === "string" && p.description ? { description: p.description } : {}),
      type,
      required: required.has(name),
      ...(readPicker(p[PICKER_KEY]) ? { picker: readPicker(p[PICKER_KEY]) } : {}),
      ...(variableOf.has(name) ? { variable: variableOf.get(name) } : {}),
    };
  });
}

/** The `schema` and the variable map (`capture`, or a Starter's `binds`) an
 *  edited field list writes, as a handler patch — a map left empty is
 *  `undefined`, which removes it. Everything the editor does not own is kept:
 *  the schema's other keywords, each property's other keywords (enum,
 *  format, …), and entries that are not the plain `$.<field>` form. */
export function fieldsPatch(n: CanvasNode, fields: readonly InputField[]): Record<string, Json | undefined> {
  const h = handlerOf(n);
  const prev = isObj(h.schema) ? h.schema : {};
  const prevProps = isObj(prev.properties) ? prev.properties : {};
  const properties: JsonObject = {};
  for (const f of fields) {
    const old = isObj(prevProps[f.name]) ? (prevProps[f.name] as JsonObject) : {};
    const { title: _t, description: _d, [PICKER_KEY]: _p, ...rest } = old;
    properties[f.name] = {
      ...rest,
      type: f.type,
      ...(f.title ? { title: f.title } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.picker ? { [PICKER_KEY]: writePicker(f.picker) } : {}),
    };
  }
  const required = fields.filter((f) => f.required).map((f) => f.name);
  const { required: _r, properties: _ps, ...schemaRest } = prev;
  const schema: JsonObject = { ...schemaRest, type: "object", properties, ...(required.length ? { required } : {}) };

  const key = mappingKey(n);
  const prevMapping = h[key];
  const prevCapture = isObj(prevMapping) ? prevMapping : {};
  const owned = new Set(Object.keys(prevProps).concat(fields.map((f) => f.name)));
  const capture: JsonObject = {};
  for (const [variable, path] of Object.entries(prevCapture)) {
    const field = capturedField(path);
    if (!field || !owned.has(field)) capture[variable] = path;
  }
  for (const f of fields) if (f.variable) capture[f.variable] = `$.${f.name}`;
  return { schema, [key]: Object.keys(capture).length ? capture : undefined };
}

export interface FormResult {
  /** The run input: the form as JSON, or the plain text when the form has no
   *  fields. */
  input: string;
  /** The JSON value, for publishing to a channel. */
  value: unknown;
  /** Per field, why it cannot be sent. Empty when the form is ready. */
  errors: Record<string, string>;
}

/** Turn what was typed into the run's input. Numbers and booleans are sent
 *  typed; an empty optional field is left out; an empty required one is an
 *  error the dialog shows beside the field. */
export function formInput(
  fields: readonly InputField[],
  values: Readonly<Record<string, string | boolean | undefined>>,
  plainText = "",
): FormResult {
  if (!fields.length) return { input: plainText, value: { text: plainText }, errors: {} };
  const out: JsonObject = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "boolean") {
      out[f.name] = v === true;
      continue;
    }
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) {
      if (f.required) errors[f.name] = "required";
      continue;
    }
    if (f.type === "number" || f.type === "integer") {
      const num = Number(text);
      if (!Number.isFinite(num) || (f.type === "integer" && !Number.isInteger(num))) {
        errors[f.name] = f.type === "integer" ? "a whole number" : "a number";
        continue;
      }
      out[f.name] = num;
    } else {
      out[f.name] = text;
    }
  }
  return { input: JSON.stringify(out), value: out, errors };
}

export interface StartPlan {
  /** The Input state — the walk's entry. */
  input: string;
  /** The state it leads to on success. */
  next?: string;
  /** The channel the form must be on before the walk starts: the next
   *  state's source when that is a Starter (browser-side until G15 Ask A). */
  publishTo?: string;
}

/** What Start does for this model, or undefined when the team has no form:
 *  its entry is neither an Input state nor a Starter reading the walk's input.
 *  An input-sourced Starter is its own front door: Start only runs. */
export function startPlan(model: CanvasModel): StartPlan | undefined {
  const entry = model.nodes.find((n) => n.id === model.entry);
  if (!entry || entry.opaque) return undefined;
  if (isInputStarter(entry)) return { input: entry.id };
  if (entry.kind !== "input") return undefined;
  const out = model.edges.filter((e) => e.from === entry.id);
  const next = (out.find((e) => e.on === "success") ?? out[0])?.to;
  const target = model.nodes.find((n) => n.id === next);
  const publishTo = target && !target.opaque && target.kind === "starter" ? handlerChannels(target).source : undefined;
  return { input: entry.id, ...(next ? { next } : {}), ...(publishTo ? { publishTo } : {}) };
}

/** Where a new Input node goes and what it is wired to: it becomes the entry,
 *  with a `success` transition into the previous entry, left of everything
 *  already drawn. A team whose entry is already an Input node gets no second
 *  one — `existing` names it so the canvas can select it instead. */
export function placeInput(
  model: CanvasModel,
  raw: JsonObject,
  derived: readonly XY[] = [],
): { model: CanvasModel; id: string; existing: boolean } {
  const entry = model.nodes.find((n) => n.id === model.entry);
  // A Starter reading the walk's input already IS the front door — and the
  // runtime refuses one that is not the entry, so nothing may go before it.
  if (entry && (entry.kind === "input" || isInputStarter(entry))) return { model, id: entry.id, existing: true };
  const id = String(raw.state);
  const xs = [...model.nodes.map((n) => n.position.x), ...derived.map((p) => p.x)];
  const position = {
    x: (xs.length ? Math.min(...xs) : 0) - 280,
    y: entry ? entry.position.y : 0,
  };
  const node: CanvasNode = { id, kind: "input", opaque: false, position, raw };
  const edges = entry
    ? [...model.edges, { from: id, to: entry.id, on: "success", raw: { from: id, to: entry.id, on: "success" } }]
    : model.edges;
  return {
    model: { ...model, nodes: [...model.nodes, node], edges, entry: id, layoutDirty: true },
    id,
    existing: false,
  };
}

export interface ChunkOption {
  id: string;
  title: string;
  /** 1 for a top-level section, 2 for its children, … */
  depth: number;
}

/** A document's chunks for a picker, in document order, the root (the
 *  document's own title chunk) left out. `maxDepth` 1 keeps the top-level
 *  sections only. */
export function chunkOptions(
  rows: readonly { id: string; title: string; position: number; parent_id?: string | null }[],
  maxDepth?: number,
): ChunkOption[] {
  const children = new Map<string, typeof rows[number][]>();
  const roots: typeof rows[number][] = [];
  for (const r of rows) {
    if (!r.parent_id) roots.push(r);
    else children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  }
  const out: ChunkOption[] = [];
  const walk = (id: string, depth: number) => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    for (const c of [...(children.get(id) ?? [])].sort((a, b) => a.position - b.position)) {
      out.push({ id: c.id, title: c.title, depth });
      walk(c.id, depth + 1);
    }
  };
  for (const r of roots) walk(r.id, 1);
  return out;
}
