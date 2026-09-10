// Deterministic layered auto-layout for a team graph.
//
// WHY hand-rolled rather than elkjs or dagre: RFC CZ defers a layout library
// on size, and a team graph is small — a dozen states, rarely more. A layered
// sweep from `entry` produces the left-to-right pipeline an operator expects,
// in ~60 lines with no dependency and no async. If graphs get big enough that
// edge crossings matter, that is the moment to reach for elk, not before.
//
// Determinism is the property that matters most: the same graph must lay out
// the same way every time, or "auto-layout on open" (RFC CZ decision 5) would
// make a definition look changed when it is not. Ordering is therefore by
// declaration order throughout, never by Map/Set iteration of ids.

import type { CanvasModel, CanvasNode, XY } from "./model";

/** Horizontal gap between layers, in px. Wide enough for an edge label. */
export const COLUMN_WIDTH = 280;
/** Vertical gap between siblings in a layer. */
export const ROW_HEIGHT = 150;

/** Assign each node a layer: the shortest hop count from `entry`.
 *
 *  Shortest-path rather than longest: a pushback edge (`review → code`) must
 *  not drag its target rightward past the node it loops back to, which is what
 *  a longest-path ranking would do to every cyclic graph — and cycles are
 *  normal here, not an edge case. */
function layerNodes(model: CanvasModel): Map<string, number> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const e of model.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  }

  const layer = new Map<string, number>();
  const start = byId.has(model.entry) ? model.entry : model.nodes[0]?.id;
  if (start !== undefined) {
    layer.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const depth = layer.get(cur)!;
      for (const next of adjacency.get(cur) ?? []) {
        if (!layer.has(next)) {
          layer.set(next, depth + 1);
          queue.push(next);
        }
      }
    }
  }

  // Anything the BFS never reached — an unreachable state, which teamgraph
  // rejects but the canvas must still draw so the operator can SEE why. Park
  // them in a trailing column rather than stacking them at the origin.
  const maxReached = layer.size ? Math.max(...layer.values()) : -1;
  for (const n of model.nodes) {
    if (!layer.has(n.id)) layer.set(n.id, maxReached + 1);
  }
  return layer;
}

/** Lay the graph out left-to-right by layer. Returns a position per state id;
 *  callers apply it and set `layoutDirty` only on an explicit save. */
export function autoLayout(model: CanvasModel): Record<string, XY> {
  const layer = layerNodes(model);

  // Bucket in DECLARATION order so the vertical ordering within a column is
  // stable across runs.
  const columns = new Map<number, CanvasNode[]>();
  for (const n of model.nodes) {
    const d = layer.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }

  const out: Record<string, XY> = {};
  for (const [depth, nodes] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    // Centre each column vertically about y=0 so a wide fan-out reads as a
    // fan rather than hanging below the spine it branches from.
    const offset = ((nodes.length - 1) * ROW_HEIGHT) / 2;
    nodes.forEach((n, i) => {
      out[n.id] = { x: depth * COLUMN_WIDTH, y: i * ROW_HEIGHT - offset };
    });
  }
  return out;
}

/** True when no node carries a stored position — i.e. the definition has no
 *  `layout` and the canvas should lay it out on open. */
export function needsAutoLayout(model: CanvasModel): boolean {
  const stored = model.source.layout;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return true;
  const nodes = (stored as Record<string, unknown>).nodes;
  if (typeof nodes !== "object" || nodes === null) return true;
  return Object.keys(nodes).length === 0;
}
