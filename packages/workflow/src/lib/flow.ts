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
  /** Which handle the edge leaves from / arrives at. Derived from geometry —
   *  see BACKWARD routing below. */
  sourceHandle: string;
  targetHandle: string;
  label: string;
  data: FlowEdgeData;
  className: string;
  /** `smoothstep` for a backward edge so it arcs cleanly below the row;
   *  the default bezier for a forward one. */
  type?: "smoothstep";
  markerEnd: { type: "arrowclosed"; width: number; height: number; color: string };
  animated?: boolean;
}

// Handle ids, shared with StateNode so the two cannot drift.
//
// A left-to-right layout needs FOUR handles, not two. With only
// target-left / source-right, a backward edge (every pushback loop — the
// characteristic shape of a team graph) has to leave the source's RIGHT side
// and re-enter the target's LEFT side, which sends it curving back through
// the nodes it connects, and stacks it on top of the forward edge running
// between the same pair so only one label is legible.
//
// Routing backward edges through the BOTTOM handles instead separates them
// from the forward edge entirely and reads the way a loop-back should.
export const HANDLE = {
  targetLeft: "t-left",
  sourceRight: "s-right",
  sourceBottom: "s-bottom",
  targetBottom: "t-bottom",
} as const;

/** `MarkerType.ArrowClosed`'s wire value. Inlined rather than imported so this
 *  module stays free of runtime dependencies and unit-testable in node. */
const ARROW = "arrowclosed" as const;

// `context-stroke` makes the arrowhead take the edge path's own stroke, so the
// marker follows the success / pushback / conditional colours from CSS and
// both themes, instead of hardcoding a palette here that would drift from
// styles.css.
const ARROW_COLOR = "context-stroke";

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

/** True when the edge runs right-to-left (or onto itself) in the current
 *  layout, and so must be routed as a loop rather than as a forward hop. */
export function isBackward(model: CanvasModel, from: string, to: string): boolean {
  if (from === to) return true;
  const a = model.nodes.find((n) => n.id === from);
  const b = model.nodes.find((n) => n.id === to);
  if (!a || !b) return false;
  return b.position.x < a.position.x;
}

export function toFlowEdges(model: CanvasModel, findings: Finding[]): FlowEdge[] {
  return model.edges.map((e, i) => {
    const backward = isBackward(model, e.from, e.to);
    return {
      id: edgeId(e),
      source: e.from,
      target: e.to,
      sourceHandle: backward ? HANDLE.sourceBottom : HANDLE.sourceRight,
      targetHandle: backward ? HANDLE.targetBottom : HANDLE.targetLeft,
      ...(backward ? { type: "smoothstep" as const } : {}),
      // `success` is the overwhelmingly common label and drawing it on every
      // edge is noise; the arrowhead now says "and then". Named routes DO
      // carry meaning and are always labelled.
      label: e.on === "success" ? "" : e.on,
      className: edgeClass(e.on),
      markerEnd: { type: ARROW, width: 18, height: 18, color: ARROW_COLOR },
      data: {
        kind: "control" as const,
        on: e.on,
        findings: findings.filter((f) => f.edgeIndex === i),
      },
    };
  });
}
