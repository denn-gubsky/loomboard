// Deterministic layered auto-layout for a team graph, along its DATA path.
//
// WHY hand-rolled rather than elkjs or dagre: RFC CZ defers a layout library
// on size, and a team graph is small — a dozen states, rarely more. A layered
// sweep produces the left-to-right pipeline an operator expects, in a page of
// code with no dependency and no async. If graphs get big enough that edge
// crossings matter, that is the moment to reach for elk, not before.
//
// WHAT is laid out: the states AND the derived nodes a pipeline runs through —
// channels and each Starter's agent node — so a two-stage team reads as one
// row in the order things happen (C2 amended):
//
//   [in] → (research) → [researcher] → [hand-off] → (edit) → [editor] → [out]   (done)
//
// Ranked by LONGEST path over the forward edges, so a Starter lands after the
// channel that feeds it even when a transition from the previous Starter would
// put it sooner. Pushback loops are what longest-path would otherwise drag
// rightward without end; they are found as DFS back edges and ignored, which
// keeps the target of a loop where its forward position is. End states take
// the column after everything else — the walk finishes there.
//
// Determinism is the property that matters most: the same graph must lay out
// the same way every time, or "auto-layout on open" (RFC CZ decision 5) would
// make a definition look changed when it is not. Ordering is by declaration
// order throughout, never by Map/Set iteration of ids.

import { agentNodeId, dispatchesAgent } from "./agentNodes";
import { channelNodeId } from "./channelNodes";
import { channelRefs } from "./channels";
import { isDerivedLayoutKey, type CanvasModel, type XY } from "./model";

/** Horizontal gap between layers, in px. Wide enough for a channel node. */
export const COLUMN_WIDTH = 280;
/** Vertical gap between siblings in a layer. */
export const ROW_HEIGHT = 150;

/** States reachable from `entry` over transitions — teamgraph's own notion of
 *  reachable. Anything else is drawn in a trailing column. */
function reachableStates(model: CanvasModel): Set<string> {
  const ids = new Set(model.nodes.map((n) => n.id));
  const start = ids.has(model.entry) ? model.entry : model.nodes[0]?.id;
  const seen = new Set<string>();
  if (start === undefined) return seen;
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of model.edges) {
      if (e.from === cur && ids.has(e.to) && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

/** Lay the graph out left-to-right. Returns a position per state id AND per
 *  derived node id (`channel:…`, `agent:…`); callers apply the states' to the
 *  nodes and the rest as derived positions, and set `layoutDirty` only on an
 *  explicit save. */
export function autoLayout(model: CanvasModel): Record<string, XY> {
  const reachable = reachableStates(model);
  const terminal = new Set(model.nodes.filter((n) => n.kind === "terminal").map((n) => n.id));

  // The pipeline graph, built in declaration order. Unreachable states sit it
  // out: they are placed after it.
  const order: string[] = [];
  const adjacency = new Map<string, string[]>();
  const add = (id: string) => {
    if (!adjacency.has(id)) {
      adjacency.set(id, []);
      order.push(id);
    }
  };
  const link = (from: string, to: string) => {
    add(from);
    add(to);
    adjacency.get(from)!.push(to);
  };
  for (const n of model.nodes) if (reachable.has(n.id)) add(n.id);
  const opaque = new Set(model.nodes.filter((n) => n.opaque).map((n) => n.id));
  const agentOf = new Map<string, string>();
  for (const n of model.nodes) {
    if (reachable.has(n.id) && dispatchesAgent(n)) agentOf.set(n.id, agentNodeId(model, n.id));
  }
  for (const [state, agent] of agentOf) link(state, agent);
  for (const r of channelRefs(model)) {
    if (!reachable.has(r.state) || opaque.has(r.state)) continue;
    const ch = channelNodeId(model, r.channel);
    if (r.side === "subscribe") link(ch, r.state);
    // A Starter's results leave from its AGENT, which is what produced them.
    else link(agentOf.get(r.state) ?? r.state, ch);
  }
  // A Starter's transitions leave from its agent, as on the canvas — so what
  // follows a Starter is placed after the agent that does its work.
  for (const e of model.edges) {
    if (reachable.has(e.from) && reachable.has(e.to)) link(agentOf.get(e.from) ?? e.from, e.to);
  }

  // Back edges by DFS, from the walk's front door first so its own direction
  // is "forward": the channel the entry reads (C7), then the entry, then
  // whatever is left in order. Starting at the entry instead would make a
  // Starter that republishes to its own source put that channel AFTER itself.
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const visit = (root: string) => {
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }];
    state.set(root, "open");
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = adjacency.get(top.id)![top.i++];
      if (next === undefined) {
        state.set(top.id, "done");
        stack.pop();
      } else if (state.get(next) === "open") {
        back.add(`${top.id}\u0000${next}`);
      } else if (!state.has(next)) {
        state.set(next, "open");
        stack.push({ id: next, i: 0 });
      }
    }
  };
  const frontDoor = channelRefs(model)
    .filter((r) => r.state === model.entry && r.side === "subscribe" && !opaque.has(r.state))
    .map((r) => channelNodeId(model, r.channel));
  for (const id of [...frontDoor, model.entry, ...order]) {
    if (adjacency.has(id) && !state.has(id)) visit(id);
  }

  // Longest path over the forward edges (Kahn), end states held back.
  const indegree = new Map(order.map((id) => [id, 0]));
  for (const [from, tos] of adjacency) {
    for (const to of tos) if (!back.has(`${from}\u0000${to}`)) indegree.set(to, indegree.get(to)! + 1);
  }
  const layer = new Map<string, number>();
  const ready = order.filter((id) => indegree.get(id) === 0);
  for (const id of ready) layer.set(id, 0);
  while (ready.length) {
    const cur = ready.shift()!;
    for (const to of adjacency.get(cur)!) {
      if (back.has(`${cur}\u0000${to}`)) continue;
      layer.set(to, Math.max(layer.get(to) ?? 0, layer.get(cur)! + 1));
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) ready.push(to);
    }
  }
  const inner = order.filter((id) => !terminal.has(id));
  const last = inner.length ? Math.max(...inner.map((id) => layer.get(id) ?? 0)) : -1;
  for (const id of order) if (terminal.has(id)) layer.set(id, last + 1);

  // Unreachable states (and their agents) after everything, so the operator
  // SEES why teamgraph refuses them rather than finding them stacked at the
  // origin.
  const maxLayer = layer.size ? Math.max(...layer.values()) : -1;
  for (const n of model.nodes) {
    if (reachable.has(n.id)) continue;
    order.push(n.id);
    layer.set(n.id, maxLayer + 1);
    if (dispatchesAgent(n)) {
      const agent = agentNodeId(model, n.id);
      order.push(agent);
      layer.set(agent, maxLayer + 2);
    }
  }

  // Bucket in that order so the vertical ordering within a column is stable.
  const columns = new Map<number, string[]>();
  for (const id of order) {
    const d = layer.get(id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), id]);
  }
  const out: Record<string, XY> = {};
  for (const [depth, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    // Centre each column vertically about y=0 so a wide fan-out reads as a
    // fan rather than hanging below the spine it branches from.
    const offset = ((ids.length - 1) * ROW_HEIGHT) / 2;
    ids.forEach((id, i) => {
      out[id] = { x: depth * COLUMN_WIDTH, y: i * ROW_HEIGHT - offset };
    });
  }
  return out;
}

/** Apply an autoLayout result: states' positions to their nodes, derived
 *  nodes' (channels, agents) as derived positions. `dirty` says whether the
 *  layout is now the operator's to save — true for the Auto-layout button,
 *  false for the layout a team with none gets on open (decision 5: opening
 *  never forks). */
export function withLayout(model: CanvasModel, pos: Record<string, XY>, dirty: boolean): CanvasModel {
  const states = new Set(model.nodes.map((n) => n.id));
  const derived = Object.fromEntries(Object.entries(pos).filter(([id]) => !states.has(id) && isDerivedLayoutKey(id)));
  return {
    ...model,
    nodes: model.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
    derivedPositions: { ...(model.derivedPositions ?? {}), ...derived },
    layoutDirty: model.layoutDirty || dirty,
  };
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
