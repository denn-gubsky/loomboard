// The model → @xyflow/react adapter.
//
// Kept pure and out of the component so the mapping is unit-testable and so
// the React layer stays a renderer rather than a translator. Nothing here
// imports React.
//
// TWO edge relations, which is RFC CZ decision C1 and the central visual
// decision in this package. `transitions[]` is CONTROL flow — the walk's own
// graph, drawn solid, drag-created, deletable. A sink channel matching some
// other node's source channel is DATA flow — derived, drawn dashed over the
// top handles, and neither draggable nor deletable, because it is a
// consequence of the two nodes' channel config rather than a thing that
// exists in the definition.
//
// They usually agree and are NOT required to: a Starter may publish to a
// channel nothing reads, and two nodes wired by a transition may share no
// channel at all. Conflating them would hide exactly the mistakes a canvas
// exists to make visible, so both are drawn and never merged.

import type { CanvasEdge, CanvasModel, CanvasNode } from "./model";
import { handlerAgents, handlerChannels, handlerOf } from "./model";
import type { Finding } from "./validate";
import type { ChannelNodeView } from "./channelNodes";

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
  /** Channels this node reads / publishes — starter and channel kinds only. */
  channels: { source?: string; sink?: string };
  /** Fan-out summary for a starter, e.g. "per message · max 8". */
  fanout?: string;
  /** Variable names a `vars` state assigns, for its face. */
  assigns: string[];
  /** Field names the `input` start form declares. */
  formFields: string[];
  /** The hooks this node adds to its runs, as `event: name` labels. */
  hooks: string[];
  isEntry: boolean;
  /** Findings anchored to this state, worst level first. */
  findings: Finding[];
  [k: string]: unknown;
}

export interface FlowEdgeData {
  kind: FlowEdgeKind;
  /** The transition label — success | pushback:<reason> | conditional:<expr>.
   *  Empty on a data edge, which carries a channel rather than a label. */
  on: string;
  /** data edges only: the channel that produced this edge. */
  channel?: string;
  findings: Finding[];
  [k: string]: unknown;
}

export interface FlowNode {
  id: string;
  type: "state";
  position: { x: number; y: number };
  data: FlowNodeData;
  selected?: boolean;
  /** What xyflow measured for this node, fed back in.
   *
   *  REQUIRED for the MiniMap, and easy to miss: a node sizes itself from CSS,
   *  so the graph renders correctly without this. The minimap does not — it
   *  reads dimensions from the store (`nodeHasDimensions` → `measured.width ??
   *  width ?? initialWidth`) and silently renders NOTHING for a node that has
   *  none. Because this adapter rebuilds every FlowNode from the model on each
   *  render, anything xyflow measured is discarded unless it is handed back. */
  measured?: { width: number; height: number };
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
  /** Data edges are derived, so xyflow must not offer to remove them — the way
   *  to "delete" one is to change a channel name in the inspector. */
  deletable?: boolean;
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
//
// The TOP pair carries DATA edges. They get their own side rather than
// sharing the control handles because the two relations routinely connect the
// SAME pair of nodes — a Starter publishing to the channel the next Starter
// reads is also, usually, the next state in the walk. Sharing handles would
// stack the two edges on one path, which is precisely the conflation C1 says
// not to do.
export const HANDLE = {
  targetLeft: "t-left",
  sourceRight: "s-right",
  sourceBottom: "s-bottom",
  targetBottom: "t-bottom",
  sourceTop: "s-top",
  targetTop: "t-top",
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

/** The one-line fan-out summary on a Starter's face: how wide the wave is and
 *  what bounds it. Returns undefined for every other kind.
 *
 *  Width is a RUNTIME property (decision C3) — `per: message` means "as many
 *  runs as there are messages", which nothing on the canvas can know. So the
 *  face states the RULE and its ceiling rather than a number that would be a
 *  guess. */
export function fanoutSummary(n: CanvasNode): string | undefined {
  if (n.kind !== "starter") return undefined;
  const raw = handlerOf(n).fanout;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const per = str(raw.per) || "message";
  if (per === "once") return "one run · whole batch";
  const max = typeof raw.max === "number" ? raw.max : undefined;
  return max ? `one run per message · max ${max}` : "one run per message";
}

/** The variable names a `vars` state assigns. Sorted, because object key order
 *  is the author's typing order and a node that reshuffles on every edit is
 *  harder to read than one that does not. */
export function assignedVars(n: CanvasNode): string[] {
  if (n.kind !== "vars") return [];
  const set = handlerOf(n).set;
  if (typeof set !== "object" || set === null || Array.isArray(set)) return [];
  return Object.keys(set).sort();
}

/** The top-level field names an `input` state's JSON Schema declares.
 *
 *  Deliberately shallow: the canvas is naming the form's inputs on a node
 *  face, not validating the schema. The runtime does not interpret it either. */
export function formFields(n: CanvasNode): string[] {
  if (n.kind !== "input") return [];
  const schema = handlerOf(n).schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [];
  const props = schema.properties;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return [];
  return Object.keys(props);
}

/** The hooks a node adds to the runs it starts (RFC DK-P4c), labelled
 *  `event: name` or `tool event: name`, in the order the runtime chains them:
 *  each tool's own first (tools by name), then the node-level ones.
 *
 *  NAMES ONLY. An inline webhook's URL may carry a token and its headers may
 *  name credentials, so the face gets what a hook_decision event would show —
 *  the same reduction as loomcycle's hooks.WithoutEndpoints. */
export function hookLabels(n: CanvasNode): string[] {
  const h = handlerOf(n);
  const label = (e: unknown): string =>
    typeof e === "string"
      ? e
      : typeof e === "object" && e !== null && !Array.isArray(e) && typeof (e as { name?: unknown }).name === "string"
        ? (e as { name: string }).name
        : "?";
  const events = (m: unknown, prefix: string): string[] => {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return [];
    return Object.keys(m)
      .sort()
      .flatMap((ev) => {
        const list = (m as Record<string, unknown>)[ev];
        return Array.isArray(list) ? list.map((e) => `${prefix}${ev}: ${label(e)}`) : [];
      });
  };
  const tools = h.tool_hooks;
  const toolLabels =
    typeof tools === "object" && tools !== null && !Array.isArray(tools)
      ? Object.keys(tools)
          .sort()
          .flatMap((t) => events((tools as Record<string, unknown>)[t], `${t} `))
      : [];
  return [...toolLabels, ...events(h.hooks, "")];
}

export function toFlowNodes(
  model: CanvasModel,
  findings: Finding[],
  selectedId?: string | null,
  /** Dimensions xyflow reported, by node id. Presentation-only — it never
   *  reaches the definition, the way `layout` does. */
  measured?: Record<string, { width: number; height: number }>,
): FlowNode[] {
  return model.nodes.map((n) => {
    const h = handlerOf(n);
    return {
      id: n.id,
      type: "state" as const,
      position: n.position,
      selected: n.id === selectedId,
      ...(measured?.[n.id] ? { measured: measured[n.id] } : {}),
      data: {
        node: n,
        agents: handlerAgents(n),
        wait: str(h.wait) || undefined,
        consolidator: str(h.consolidator) || undefined,
        channels: handlerChannels(n),
        fanout: fanoutSummary(n),
        assigns: assignedVars(n),
        formFields: formFields(n),
        hooks: hookLabels(n),
        isEntry: !!model.entry && n.id === model.entry,
        findings: findings
          .filter((f) => f.nodeId === n.id)
          .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)),
      },
    };
  });
}

export type Measured = Record<string, { width: number; height: number }>;

/** Merge freshly measured dimensions, returning the SAME object when nothing
 *  changed.
 *
 *  The identity check is the point, not an optimisation: the measured map feeds
 *  the node array, which xyflow measures, which emits dimension changes. A new
 *  object every time would loop. */
export function mergeMeasured(prev: Measured, sized: Measured): Measured {
  const changed = Object.entries(sized).some(
    ([id, d]) => prev[id]?.width !== d.width || prev[id]?.height !== d.height,
  );
  return changed ? { ...prev, ...sized } : prev;
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

/** A data edge's id. Distinct in shape from `edgeId`'s `from on to` so the two
 *  namespaces cannot collide — a transition labelled with a channel name would
 *  otherwise be able to produce the same string. */
export function dataEdgeId(from: string, to: string): string {
  return `data:${from} > ${to}`;
}

/** Handle ids on a channel node. In on the left, out on the right: a channel
 *  sits ABOVE the states it connects, so a publisher's top handle rises into
 *  its left side and its right side drops into a reader's top handle. */
export const CHANNEL_HANDLE = { in: "ch-in", out: "ch-out" } as const;

export interface ChannelFlowData {
  view: ChannelNodeView;
  [k: string]: unknown;
}

export interface ChannelFlowNode {
  id: string;
  type: "channel";
  position: { x: number; y: number };
  data: ChannelFlowData;
  selected?: boolean;
  measured?: { width: number; height: number };
  /** Derived from the nodes' config, so there is nothing to delete — the way to
   *  remove one is to stop naming the channel. */
  deletable: false;
  /** No new wiring by drag yet: a transition into a channel would be
   *  meaningless, and wiring a sink or source by drag is its own change. */
  connectable: false;
}

export function toChannelFlowNodes(
  views: readonly ChannelNodeView[],
  selectedId?: string | null,
  measured?: Measured,
): ChannelFlowNode[] {
  return views.map((v) => ({
    id: v.id,
    type: "channel" as const,
    position: v.position,
    selected: v.id === selectedId,
    deletable: false as const,
    connectable: false as const,
    data: { view: v },
    // Exactly as toFlowNodes does it: the MiniMap draws only nodes with
    // measured dimensions.
    ...(measured?.[v.id] ? { measured: measured[v.id] } : {}),
  }));
}

/** Derive the DATA edges, routed through channel nodes: one edge per
 *  (publisher → channel) and one per (channel → reader).
 *
 *  Not stored anywhere — recomputed from the nodes' channel config every time,
 *  because that config is the only truth. They are not required to agree with
 *  `transitions[]`: publishing to a channel nothing reads is how you park
 *  results for a human, and a transition between two states that share no
 *  channel is the ordinary case for non-Starter kinds (decision C1).
 *
 *  Through a node rather than direct: N publishers and M readers of one
 *  channel are N + M edges into one visible junction, not N × M unrelated
 *  lines — which is what makes a fan-in readable. A channel nothing reads, or
 *  nothing publishes to, still gets its node and its one side, so a dangling
 *  sink is visible instead of silently edge-less. A Starter that republishes
 *  to the channel it reads draws both edges: a real, usually unintended loop. */
export function toDataEdges(views: readonly ChannelNodeView[]): FlowEdge[] {
  const out: FlowEdge[] = [];
  const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, channel: string): FlowEdge => ({
    id: dataEdgeId(source, target),
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep" as const,
    // The channel node names the channel, so the edge does not repeat it.
    label: "",
    className: "lb-wf-edge lb-wf-edge--data",
    markerEnd: { type: ARROW, width: 14, height: 14, color: ARROW_COLOR },
    deletable: false,
    data: { kind: "data" as const, on: "", channel, findings: [] },
  });
  for (const v of views) {
    for (const p of v.publishers) out.push(edge(p, v.id, HANDLE.sourceTop, CHANNEL_HANDLE.in, v.channel));
    for (const r of v.readers) out.push(edge(v.id, r, CHANNEL_HANDLE.out, HANDLE.targetTop, v.channel));
  }
  return out;
}
