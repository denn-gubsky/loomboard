// The model → @xyflow/react adapter.
//
// Kept pure and out of the component so the mapping is unit-testable and so
// the React layer stays a renderer rather than a translator. Nothing here
// imports React.
//
// P0 draws CONTROL edges only — `transitions[]`, the walk's own graph. RFC CZ
// decision C1 adds a second, derived relation once the Starter lands (a sink
// channel matching a downstream source), drawn dashed and non-draggable. The
// edge type is already carried on each edge so that addition does not have to
// reshape this contract.

import type { CanvasEdge, CanvasModel, CanvasNode } from "./model";
import { handlerAgents, handlerOf } from "./model";
import type { Finding } from "./validate";

/** Which relation an edge represents. `control` is a transition the operator
 *  drew; `data` is derived from channel wiring and is never draggable. */
export type FlowEdgeKind = "control" | "data";

export interface FlowNodeData {
  node: CanvasNode;
  /** Rendered under the title: the agents this state runs. */
  agents: string[];
  /** e.g. "all", "at_least:2" — parallel only. */
  wait?: string;
  consolidator?: string;
  isEntry: boolean;
  /** Findings anchored to this state, worst level first. */
  findings: Finding[];
  [k: string]: unknown;
}

export interface FlowEdgeData {
  kind: FlowEdgeKind;
  /** The transition label — success | pushback:<reason> | conditional:<expr>. */
  on: string;
  findings: Finding[];
  [k: string]: unknown;
}

export interface FlowNode {
  id: string;
  type: "state";
  position: { x: number; y: number };
  data: FlowNodeData;
  selected?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  data: FlowEdgeData;
  className: string;
  animated?: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The CSS modifier for an edge, from its transition label. `pushback:redo`
 *  and `pushback:rework` share one class — the reason is in the label, not the
 *  colour, and one class per reason would be unbounded. */
export function edgeClass(on: string): string {
  if (on.startsWith("pushback")) return "lb-wf-edge lb-wf-edge--pushback";
  if (on.startsWith("conditional")) return "lb-wf-edge lb-wf-edge--conditional";
  return "lb-wf-edge lb-wf-edge--success";
}

/** A stable edge id. Transitions have no id of their own, and index alone
 *  would reshuffle every handle on a delete — from/to/on is unique because
 *  teamgraph refuses duplicate outbound labels per state. */
export function edgeId(e: CanvasEdge): string {
  return `${e.from} ${e.on} ${e.to}`;
}

export function toFlowNodes(
  model: CanvasModel,
  findings: Finding[],
  selectedId?: string | null,
): FlowNode[] {
  return model.nodes.map((n) => {
    const h = handlerOf(n);
    return {
      id: n.id,
      type: "state" as const,
      position: n.position,
      selected: n.id === selectedId,
      data: {
        node: n,
        agents: handlerAgents(n),
        wait: str(h.wait) || undefined,
        consolidator: str(h.consolidator) || undefined,
        isEntry: !!model.entry && n.id === model.entry,
        findings: findings
          .filter((f) => f.nodeId === n.id)
          .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)),
      },
    };
  });
}

export function toFlowEdges(model: CanvasModel, findings: Finding[]): FlowEdge[] {
  return model.edges.map((e, i) => ({
    id: edgeId(e),
    source: e.from,
    target: e.to,
    // `success` is the overwhelmingly common label and drawing it on every
    // edge is noise; the arrow already says "and then". Named routes DO carry
    // meaning and are always labelled.
    label: e.on === "success" ? "" : e.on,
    className: edgeClass(e.on),
    data: {
      kind: "control" as const,
      on: e.on,
      findings: findings.filter((f) => f.edgeIndex === i),
    },
  }));
}
