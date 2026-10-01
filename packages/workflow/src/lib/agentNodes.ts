// Agent nodes: the agent a Starter dispatches, drawn as a node of its own
// between the Starter and the channel its results go to (RFC CZ, C2 amended).
//
// WHY a node: a Starter reads, dispatches and publishes, and with all three on
// one face the pipeline a team actually is — channel → Starter → agent →
// channel → … — could not be seen on the graph at all. Separating the agent
// puts each step in the order it happens, and gives the runs a place of their
// own: the agent is what runs.
//
// NOT a state, and that part of C2 stands. The agent has no transitions, no
// iteration count and no place in the walk; it is the Starter's fan-out
// config, drawn. Selecting it selects its Starter, whose inspector already
// edits `fanout`. Derived like a channel node: the definition stores nothing
// for it but its position, under a reserved layout key.
//
// Pure: no React, no network.

import {
  AGENT_LAYOUT_PREFIX,
  handlerAgents,
  storedDerivedPosition,
  type CanvasModel,
  type CanvasNode,
  type XY,
} from "./model";

/** How far below its Starter an agent node sits when nothing placed it — a
 *  saved layout from before agent nodes existed. Auto-layout puts it in the
 *  row instead (lib/layout.ts). */
export const AGENT_DROP = 130;

export interface AgentNodeView {
  /** `agent:<state>`, made unique against state ids. */
  id: string;
  /** The Starter that dispatches it. */
  state: string;
  /** The fan-out's agent(s); empty while the Starter names none yet. */
  agents: string[];
  position: XY;
  /** True when the position came from the layout rather than placement. */
  placed: boolean;
}

/** The Starters that get an agent node: every Starter this canvas can read.
 *  An opaque node's fields mean what a newer runtime says (decision 3). */
export function dispatchesAgent(n: CanvasNode): boolean {
  return !n.opaque && n.kind === "starter";
}

/** The agent node id for a Starter, unique against the model's state ids — a
 *  state may legally be named "agent:x", and keeps its id. */
export function agentNodeId(model: CanvasModel, state: string): string {
  const states = new Set(model.nodes.map((n) => n.id));
  let id = AGENT_LAYOUT_PREFIX + state;
  while (states.has(id)) id += "'";
  return id;
}

export function agentNodes(model: CanvasModel): AgentNodeView[] {
  return model.nodes.filter(dispatchesAgent).map((n) => {
    const id = agentNodeId(model, n.id);
    const stored = storedDerivedPosition(model, id);
    return {
      id,
      state: n.id,
      agents: handlerAgents(n),
      position: stored ?? { x: n.position.x, y: n.position.y + AGENT_DROP },
      placed: !!stored,
    };
  });
}

/** The Starter an agent node belongs to, or undefined for any other id. */
export function agentOwner(views: readonly AgentNodeView[], id: string): string | undefined {
  return views.find((v) => v.id === id)?.state;
}
