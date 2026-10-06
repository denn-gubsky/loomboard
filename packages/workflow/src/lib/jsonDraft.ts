// The canvas model ⇄ the JSON view's draft (RFC DX phase 3).
//
// `viewDefinition` is what the JSON view shows: the draft as it will be saved,
// with the layout ALWAYS written, so the text carries the positions the canvas
// shows (toDefinition writes the layout only once something moved).
//
// `fromJsonDraft` is the way back: the canvas rebuilt from a definition the
// operator typed. A state the text gives no position keeps the one it had on
// the canvas, or — when it is new — is placed right of the graph, so typing a
// state never reshuffles the ones already drawn.
//
// Pure: no React, no network.

import { fromDefinition, toDefinition, type CanvasModel, type JsonObject, type XY } from "./model";

/** The draft as the JSON view shows it. */
export function viewDefinition(model: CanvasModel): JsonObject {
  return toDefinition({ ...model, layoutDirty: true });
}

const COLUMN = 260;
const ROW = 160;

function storedIds(def: JsonObject): Set<string> {
  const layout = def.layout;
  const nodes =
    typeof layout === "object" && layout !== null && !Array.isArray(layout) ? (layout as JsonObject).nodes : undefined;
  return new Set(typeof nodes === "object" && nodes !== null && !Array.isArray(nodes) ? Object.keys(nodes) : []);
}

/** The canvas model for a definition typed in the JSON view, positions kept
 *  from `prev` (the model before the edit) where the text has none. */
export function fromJsonDraft(def: JsonObject, prev: CanvasModel | null): CanvasModel {
  const next = fromDefinition(def);
  const stored = storedIds(def);
  const before = new Map((prev?.nodes ?? []).map((n) => [n.id, n.position]));
  const placed = next.nodes.filter((n) => stored.has(n.id) || before.has(n.id));
  const right = placed.length ? Math.max(...placed.map((n) => n.position.x)) + COLUMN : 0;
  let fresh = 0;
  let moved = false;
  const nodes = next.nodes.map((n) => {
    if (stored.has(n.id)) return n;
    moved = true;
    const position: XY = before.get(n.id) ?? { x: right, y: fresh++ * ROW };
    return { ...n, position };
  });
  // A position the text did not carry is one the canvas chose: written back
  // with the next save, like any drag.
  return moved ? { ...next, nodes, layoutDirty: true } : next;
}
