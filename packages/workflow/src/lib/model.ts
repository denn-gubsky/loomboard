// The definition ⇄ canvas model, and the passthrough guarantee that makes the
// canvas safe to be the ONLY editor of a TeamDef.
//
// WHY this file is written as a diff over the source document rather than as a
// parse-into-typed-struct: RFC CZ removes the raw-JSON textarea, so anything
// this model cannot represent becomes uneditable — and anything it DROPS
// becomes unrecoverable. A definition may legitimately carry handler kinds,
// handler fields and top-level keys this canvas version has never heard of: a
// newer runtime, a hand-authored graph, or an RFC CY phase that shipped after
// this package did.
//
// So the model keeps the parsed source verbatim and rebuilds from it, writing
// back only what the operator actually changed. An unedited round trip is
// byte-identical (apart from `layout`), which is the property model.test.ts
// pins and the reason loomcycle's TeamsView JSON editor can be retired.
//
// Pure: no React, no @xyflow/react, no network. This is the unit-test surface.

/** A JSON value, as parsed. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface XY {
  x: number;
  y: number;
}

/** Handler kinds this canvas version renders natively. Anything else becomes an
 *  opaque node — drawn, positionable, connectable, and written back untouched.
 *
 *  P0 covered the four kinds RFC AP ships. `starter` and `channel` join here at
 *  P4, now that RFC CY L4 has landed (#1192/#1194/#1195). `vars` and `input`
 *  are deliberately still absent: the runtime knows them, this canvas does not
 *  render them yet, and an opaque node is the honest way to say so — it draws,
 *  it round-trips byte-identically, and the mirror reports it at `info` rather
 *  than red. They join at P2. */
export const KNOWN_KINDS = [
  "agent",
  "parallel",
  "consolidator",
  "terminal",
  "starter",
  "channel",
] as const;
export type KnownKind = (typeof KNOWN_KINDS)[number];

export function isKnownKind(kind: string): kind is KnownKind {
  return (KNOWN_KINDS as readonly string[]).includes(kind);
}

export interface CanvasNode {
  /** The state id — `states[].state`. Unique per the substrate's validator, but
   *  the model tolerates duplicates so the validation mirror can report them
   *  rather than the parser throwing. */
  id: string;
  /** `handler.kind`, or "" when the handler is missing or malformed. */
  kind: string;
  /** True when `kind` is not one this canvas version renders. Its `raw` is
   *  preserved verbatim on save. */
  opaque: boolean;
  position: XY;
  /** The original `states[]` entry, exactly as parsed. Never mutated. */
  raw: JsonObject;
  /** State-level keys the operator changed (e.g. a rename). */
  statePatch?: JsonObject;
  /** Handler-level keys the operator changed. */
  handlerPatch?: JsonObject;
}

export interface CanvasEdge {
  from: string;
  to: string;
  /** `success` | `pushback:<reason>` | `conditional:<expr>`. Defaults to
   *  `success` when absent, matching teamgraph's walk. */
  on: string;
  /** The original `transitions[]` entry, exactly as parsed. */
  raw: JsonObject;
}

export interface CanvasModel {
  /** The parsed definition, verbatim. Never mutated; `toDefinition` clones it
   *  and overwrites only the keys the operator touched. */
  source: JsonObject;
  entry: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** True once a node has been moved. Until then `toDefinition` does not write
   *  `layout`, so merely OPENING a team that has none never forks it
   *  (RFC CZ decision 5). */
  layoutDirty: boolean;
}

// ---- parsing ----

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Structural deep clone that preserves key insertion order, which is what
 *  makes the round trip byte-identical. */
function clone<T extends Json>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function readLayout(source: JsonObject): Record<string, XY> {
  const out: Record<string, XY> = {};
  const layout = source.layout;
  if (!isObj(layout)) return out;
  const nodes = layout.nodes;
  if (!isObj(nodes)) return out;
  for (const [id, pos] of Object.entries(nodes)) {
    if (!isObj(pos)) continue;
    const x = pos.x;
    const y = pos.y;
    if (typeof x === "number" && typeof y === "number") out[id] = { x, y };
  }
  return out;
}

/** Parse a stored `definition` into the canvas model.
 *
 *  Defensive by design: a malformed or partial definition yields a model that
 *  still renders, because refusing to open a team is strictly worse than
 *  showing it with a validation error next to it. */
export function fromDefinition(raw: unknown): CanvasModel {
  const source: JsonObject = isObj(raw) ? clone(raw) : {};
  const layout = readLayout(source);

  const nodes: CanvasNode[] = [];
  const states = source.states;
  if (Array.isArray(states)) {
    states.forEach((s, i) => {
      if (!isObj(s)) return;
      const id = str(s.state);
      const handler = isObj(s.handler) ? s.handler : undefined;
      const kind = handler ? str(handler.kind) : "";
      nodes.push({
        id,
        kind,
        opaque: !isKnownKind(kind),
        // Fall back to a deterministic stagger rather than (0,0) for every
        // node, so a definition with no layout is readable before auto-layout
        // runs and never renders as one pile.
        position: layout[id] ?? { x: (i % 4) * 260, y: Math.floor(i / 4) * 160 },
        raw: s,
      });
    });
  }

  const edges: CanvasEdge[] = [];
  const transitions = source.transitions;
  if (Array.isArray(transitions)) {
    for (const t of transitions) {
      if (!isObj(t)) continue;
      const from = str(t.from);
      const to = str(t.to);
      if (!from || !to) continue;
      edges.push({ from, to, on: str(t.on) || "success", raw: t });
    }
  }

  return { source, entry: str(source.entry), nodes, edges, layoutDirty: false };
}

// ---- serialising ----

function serializeState(n: CanvasNode): JsonObject {
  // The passthrough fast path: an untouched node is written back exactly as it
  // was read, which is what keeps an opaque node's unknown fields intact.
  if (!n.statePatch && !n.handlerPatch) return clone(n.raw);

  const out = clone(n.raw);
  if (n.handlerPatch) {
    const base = isObj(out.handler) ? out.handler : {};
    // Spread order matters: existing keys keep their position, new keys append.
    out.handler = { ...base, ...clone(n.handlerPatch) };
  }
  return n.statePatch ? { ...out, ...clone(n.statePatch) } : out;
}

/** Rebuild the stored `definition` from the model.
 *
 *  Everything the canvas does not model — unknown top-level keys, unknown
 *  handler fields, `colors`, anything a later RFC CY phase adds — survives
 *  because it is cloned from `source` and never overwritten. */
export function toDefinition(model: CanvasModel): JsonObject {
  const out = clone(model.source);

  if (model.entry) out.entry = model.entry;
  out.states = model.nodes.map(serializeState);
  out.transitions = model.edges.map((e) => clone(e.raw));

  if (model.layoutDirty) {
    const nodes: JsonObject = {};
    for (const n of model.nodes) nodes[n.id] = { x: n.position.x, y: n.position.y };
    const prev = isObj(out.layout) ? out.layout : {};
    out.layout = { ...prev, nodes };
  }

  return out;
}

// ---- helpers the UI layer needs, kept here because they are pure ----

/** The handler object for a node, merged with any pending patch. Read-only view
 *  for the inspector; writes go through `patchHandler`. */
export function handlerOf(n: CanvasNode): JsonObject {
  const base = isObj(n.raw.handler) ? n.raw.handler : {};
  return n.handlerPatch ? { ...base, ...n.handlerPatch } : base;
}

/** Return a node with `fields` merged into its handler patch. A field set to
 *  `undefined` is DELETED from the patch rather than written as undefined, so
 *  "revert my edit" restores the raw value instead of shadowing it — which is
 *  also what lets the node fall back onto the byte-identical fast path. */
export function patchHandler(
  n: CanvasNode,
  fields: Record<string, Json | undefined>,
): CanvasNode {
  const next: JsonObject = { ...(n.handlerPatch ?? {}) };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  const kind = typeof next.kind === "string" ? next.kind : n.kind;
  return {
    ...n,
    kind,
    opaque: !isKnownKind(kind),
    handlerPatch: Object.keys(next).length ? next : undefined,
  };
}

/** The states reachable in one step from `from` — the valid drag targets. */
export function allowedTargets(model: CanvasModel, from: string): string[] {
  return model.edges.filter((e) => e.from === from).map((e) => e.to);
}

/** The agent name(s) a node's handler runs, for the node face.
 *
 *  A Starter names its agents in `fanout`, not in `agent`/`agents` — the
 *  runtime refuses the latter on a starter outright. So the lookup is by kind
 *  rather than by trying both shapes on every node: a starter with a stray
 *  top-level `agent` is invalid, and drawing it as if it ran that agent would
 *  hide the error the inspector is about to show. */
export function handlerAgents(n: CanvasNode): string[] {
  const h = handlerOf(n);
  if (n.kind === "starter") {
    const f = isObj(h.fanout) ? h.fanout : {};
    const one = str(f.agent);
    if (one) return [one];
    return Array.isArray(f.agents)
      ? f.agents.filter((a): a is string => typeof a === "string" && !!a)
      : [];
  }
  const one = str(h.agent);
  if (one) return [one];
  if (Array.isArray(h.agents)) {
    return h.agents.filter((a): a is string => typeof a === "string" && !!a);
  }
  const cons = str(h.consolidator);
  return cons ? [cons] : [];
}
