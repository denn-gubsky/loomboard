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
import type { BindingNodeView } from "./bindings";
import { agentNodeId, dispatchesAgent, type AgentNodeView } from "./agentNodes";
import type { ResultItem } from "./output";
import type { RunLine } from "../types";
import type { VariableNodeView } from "./variables";

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
  /** While a walk is live or its trace is on screen: this state's runs, e.g.
   *  "3/8 done · 1 held · 4 running" (lib/runs.ts). */
  pulse?: string;
  /** How many of this state's runs are held for review — drawn louder, since
   *  a hold waits for a person. */
  held?: number;
  /** While a walk runs: where it is (lib/progress.ts). `current` marks an
   *  active state — the walk's position, drawn above the node. */
  progress?: "active" | "passed";
  current?: boolean;
  /** An agent state with a run going: that run's last few lines, live. */
  lines?: RunLine[];
  /** End nodes only: what the walk that finished here produced. */
  result?: ResultItem[];
  /** The entry Input node only, when a walk can be started: opens Start. */
  start?: () => void;
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

// Handle ids, shared with the node components so the two cannot drift.
//
// A left-to-right layout needs FOUR control handles, not two. With only
// target-left / source-right, a backward edge (every pushback loop — the
// characteristic shape of a team graph) has to leave the source's RIGHT side
// and re-enter the target's LEFT side, which sends it curving back through
// the nodes it connects, and stacks it on top of the forward edge running
// between the same pair so only one label is legible. Routing backward edges
// through the BOTTOM handles separates them from the forward edge entirely.
//
// DATA handles are named by role, not side, because the side depends on the
// kind (C9 amended). A Starter sits IN the data row — channel → Starter →
// agent → channel — so it reads on its LEFT and dispatches to its agent on
// its RIGHT, and its control handles move to the bottom pair: a transition
// between Starters runs under the row, never along the data path it usually
// parallels. A publish node keeps its data handle on top. Either way a data
// edge and a control edge between the same two nodes never share a path,
// which is the conflation C1 says not to do.
export const HANDLE = {
  targetLeft: "t-left",
  sourceRight: "s-right",
  sourceBottom: "s-bottom",
  targetBottom: "t-bottom",
  /** Where a Starter reads its channel (its left side). */
  dataIn: "d-in",
  /** Where a Starter dispatches its agent (its right side), or a publish node
   *  publishes (its top). */
  dataOut: "d-out",
  /** Where a variable is read FROM this state (its capture, form or set):
   *  the bottom, at the far end from the binding handle. */
  sourceVar: "s-var",
  /** Where a binding (a Document / Memory its prompt names) feeds in: the
   *  bottom, offset from the loop handle so a binding edge cannot stack on a
   *  pushback loop. Only on kinds that carry a prompt. */
  targetBind: "t-bind",
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

/** True when a transition only restates the data path: its target reads the
 *  channel its source publishes to. The walk does move along it, but the data
 *  row already says so, so it is drawn quietly under the row. */
export function followsData(model: CanvasModel, from: string, to: string): boolean {
  const a = model.nodes.find((n) => n.id === from);
  const b = model.nodes.find((n) => n.id === to);
  if (!a || !b || a.opaque || b.opaque) return false;
  const sink = handlerChannels(a).sink;
  return !!sink && handlerChannels(b).source === sink;
}

/** Marks the transitions a running walk has taken: bolder, and green. The
 *  arrowhead is `context-stroke`, so it follows the class. */
export function markTaken(edges: FlowEdge[], taken: ReadonlySet<string> | undefined): FlowEdge[] {
  if (!taken?.size) return edges;
  return edges.map((e) => (e.data?.kind === "control" && taken.has(e.id) ? { ...e, className: `${e.className} lb-wf-edge--taken` } : e));
}

/** A transition's label: the step it takes, `research → edit`, plus its
 *  route when that is not plain `success` (`review → code · pushback:redo`).
 *  Named for the states because a transition beside a data row is otherwise
 *  easy to misread as a second data path — it says WHEN the next state runs,
 *  not what reaches it. */
export function transitionLabel(e: CanvasEdge): string {
  const step = `${e.from} → ${e.to}`;
  return e.on === "success" ? step : `${step} · ${e.on}`;
}

/** The edges to draw: everything, or — with transitions switched off — only
 *  the derived ones (data, dispatch, bindings), so the data row reads alone. */
export function visibleEdges(edges: readonly FlowEdge[], showTransitions: boolean): FlowEdge[] {
  return showTransitions ? [...edges] : edges.filter((e) => e.data.kind !== "control");
}

export function toFlowEdges(model: CanvasModel, findings: Finding[]): FlowEdge[] {
  const inRow = new Set(model.nodes.filter(dispatchesAgent).map((n) => n.id));
  return model.edges.map((e, i) => {
    const backward = isBackward(model, e.from, e.to);
    // A Starter's sides carry its data, so its control handles are the bottom
    // pair; a backward edge uses them on every kind.
    const toBottom = backward || inRow.has(e.to);
    const follows = followsData(model, e.from, e.to);
    // A Starter's transitions LEAVE FROM ITS AGENT. The state's outcome is
    // its runs' results — the Starter only dispatches (RFC DJ) and the run
    // holds the output (RFC DI) — so "and then" starts where the work ended.
    // The edge is still the Starter's transition: same id, same `from`.
    const fromAgent = inRow.has(e.from);
    const fromBottom = backward || fromAgent;
    return {
      id: edgeId(e),
      source: fromAgent ? agentNodeId(model, e.from) : e.from,
      target: e.to,
      sourceHandle: fromAgent ? AGENT_HANDLE.control : fromBottom ? HANDLE.sourceBottom : HANDLE.sourceRight,
      targetHandle: toBottom ? HANDLE.targetBottom : HANDLE.targetLeft,
      ...(fromBottom || toBottom ? { type: "smoothstep" as const } : {}),
      label: transitionLabel(e),
      className: edgeClass(e.on) + (follows ? " lb-wf-edge--follows" : ""),
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

/** Handle ids on a channel node: in on the left, out on the right, so in the
 *  data row a channel passes left to right like everything else in it. */
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
  /** A WIRED channel exists because a node's config names it, so there is
   *  nothing to delete — the way to remove it is to stop naming it. Only a
   *  placed channel nothing is wired to can be removed. */
  deletable: boolean;
  /** Drag to or from a channel sets a Starter's source / sink or a publish
   *  node's channel (lib/channelWiring.ts); nothing else is accepted. */
  connectable: true;
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
    deletable: !v.wired,
    connectable: true as const,
    data: { view: v },
    // Exactly as toFlowNodes does it: the MiniMap draws only nodes with
    // measured dimensions.
    ...(measured?.[v.id] ? { measured: measured[v.id] } : {}),
  }));
}

/** Derive the DATA edges, routed through channel nodes and agent nodes:
 *  (channel → Starter) for what it reads, (Starter → its agent) for the
 *  dispatch, and (agent → channel) for what the agent's runs publish — the
 *  RESULTS leave from the agent, because the agent is what produced them. A
 *  publish node, which runs no agent, publishes from its own handle.
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
export function toDataEdges(views: readonly ChannelNodeView[], agents: readonly AgentNodeView[] = []): FlowEdge[] {
  const out: FlowEdge[] = [];
  const edge = (
    source: string,
    target: string,
    sourceHandle: string,
    targetHandle: string,
    channel?: string,
  ): FlowEdge => ({
    id: dataEdgeId(source, target),
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep" as const,
    // The channel node names the channel, so the edge does not repeat it.
    label: "",
    className: channel ? "lb-wf-edge lb-wf-edge--data" : "lb-wf-edge lb-wf-edge--dispatch",
    markerEnd: { type: ARROW, width: 14, height: 14, color: ARROW_COLOR },
    deletable: false,
    data: { kind: "data" as const, on: "", ...(channel ? { channel } : {}), findings: [] },
  });
  const agentOf = new Map(agents.map((a) => [a.state, a.id]));
  for (const a of agents) out.push(edge(a.state, a.id, HANDLE.dataOut, AGENT_HANDLE.in));
  for (const v of views) {
    for (const p of v.publishers) {
      const agent = agentOf.get(p);
      out.push(
        agent
          ? edge(agent, v.id, AGENT_HANDLE.out, CHANNEL_HANDLE.in, v.channel)
          : edge(p, v.id, HANDLE.dataOut, CHANNEL_HANDLE.in, v.channel),
      );
    }
    for (const r of v.readers) out.push(edge(v.id, r, CHANNEL_HANDLE.out, HANDLE.dataIn, v.channel));
  }
  return out;
}

/** Handle ids on an agent node: the dispatch arrives on the left, results
 *  leave on the right — and a drag from there to a channel sets the Starter's
 *  sink (lib/channelWiring.ts). `control`, on the bottom, is where the
 *  Starter's transitions leave: a drag from it to a state adds one. */
export const AGENT_HANDLE = { in: "a-in", out: "a-out", control: "a-ctl" } as const;

export interface AgentFlowData {
  view: AgentNodeView;
  /** While a walk is live or its trace is on screen: the runs of this agent,
   *  e.g. "3/8 done · 1 held" — they are the Starter's runs, shown where they
   *  run (lib/runs.ts). */
  pulse?: string;
  held?: number;
  /** Its Starter's place in a running walk (lib/progress.ts). */
  progress?: "active" | "passed";
  /** The run going on it: its last few lines, live. */
  lines?: RunLine[];
  [k: string]: unknown;
}

export interface AgentFlowNode {
  id: string;
  type: "agent";
  position: { x: number; y: number };
  data: AgentFlowData;
  selected?: boolean;
  measured?: { width: number; height: number };
  /** Derived from the Starter's fan-out: removed by removing the Starter. */
  deletable: false;
  connectable: true;
}

/** Agent nodes for xyflow. One is SELECTED with its Starter: selecting either
 *  edits the same state, and the pair should read as one thing. */
export function toAgentFlowNodes(
  views: readonly AgentNodeView[],
  selectedId?: string | null,
  measured?: Measured,
): AgentFlowNode[] {
  return views.map((v) => ({
    id: v.id,
    type: "agent" as const,
    position: v.position,
    selected: !!selectedId && (v.state === selectedId || v.id === selectedId),
    deletable: false as const,
    connectable: true as const,
    data: { view: v },
    ...(measured?.[v.id] ? { measured: measured[v.id] } : {}),
  }));
}

/** A binding node's one handle: its top, rising into the states it feeds. */
export const BINDING_HANDLE = { out: "b-out" } as const;

export interface BindingFlowData {
  view: BindingNodeView;
  [k: string]: unknown;
}

export interface BindingFlowNode {
  id: string;
  type: "binding";
  position: { x: number; y: number };
  data: BindingFlowData;
  selected?: boolean;
  measured?: { width: number; height: number };
  /** Derived from a prompt's text: removed by editing the prompt. */
  deletable: boolean;
  connectable: true;
}

export function toBindingFlowNodes(
  views: readonly BindingNodeView[],
  selectedId?: string | null,
  measured?: Measured,
): BindingFlowNode[] {
  return views.map((v) => ({
    id: v.id,
    type: "binding" as const,
    position: v.position,
    selected: v.id === selectedId,
    // One nothing reads is only a placed position: it can be deleted. One a
    // prompt names exists because of that prompt.
    deletable: v.readers.length === 0,
    connectable: true as const,
    data: { view: v },
    ...(measured?.[v.id] ? { measured: measured[v.id] } : {}),
  }));
}

/** One edge per (binding → state that reads it). Several fields of one state
 *  naming the same binding are one edge: the relation is "this state reads
 *  it", and which field is on the panel. */
export function toBindingEdges(views: readonly BindingNodeView[]): FlowEdge[] {
  const out: FlowEdge[] = [];
  for (const v of views) {
    for (const state of [...new Set(v.readers.map((r) => r.state))]) {
      out.push({
        id: `bind:${v.id} > ${state}`,
        source: v.id,
        target: state,
        sourceHandle: BINDING_HANDLE.out,
        targetHandle: HANDLE.targetBind,
        type: "smoothstep" as const,
        label: "",
        className: "lb-wf-edge lb-wf-edge--binding",
        markerEnd: { type: ARROW, width: 14, height: 14, color: ARROW_COLOR },
        deletable: false,
        data: { kind: "data" as const, on: "", findings: [] },
      });
    }
  }
  return out;
}

/** Handle ids on a variable node: its sources arrive on the left, and it
 *  feeds the states that read it from the top. */
export const VARIABLE_HANDLE = { in: "v-in", out: "v-out" } as const;

export interface VariableFlowData {
  view: VariableNodeView;
  [k: string]: unknown;
}

export interface VariableFlowNode {
  id: string;
  type: "variable";
  position: { x: number; y: number };
  data: VariableFlowData;
  selected?: boolean;
  deletable: false;
  connectable: true;
  measured?: { width: number; height: number };
}

export function toVariableFlowNodes(
  views: readonly VariableNodeView[],
  selectedId?: string | null,
  measured?: Measured,
): VariableFlowNode[] {
  return views.map((v) => ({
    id: v.id,
    type: "variable" as const,
    position: v.position,
    selected: v.id === selectedId,
    deletable: false as const,
    connectable: true as const,
    data: { view: v },
    ...(measured?.[v.id] ? { measured: measured[v.id] } : {}),
  }));
}

/** A variable's lines: one from each state it is read FROM, and one to each
 *  state whose prompt reads it. Derived from the definition, so neither is
 *  draggable or deletable. */
export function toVariableEdges(views: readonly VariableNodeView[]): FlowEdge[] {
  const edge = (id: string, source: string, target: string, sourceHandle: string, targetHandle: string): FlowEdge => ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep" as const,
    label: "",
    className: "lb-wf-edge lb-wf-edge--variable",
    markerEnd: { type: ARROW, width: 14, height: 14, color: ARROW_COLOR },
    deletable: false,
    data: { kind: "data" as const, on: "", findings: [] },
  });
  const out: FlowEdge[] = [];
  for (const v of views) {
    for (const state of [...new Set(v.sources.map((s) => s.state))]) {
      out.push(edge(`var:${state} > ${v.id}`, state, v.id, HANDLE.sourceVar, VARIABLE_HANDLE.in));
    }
    for (const state of [...new Set(v.readers.map((r) => r.state))]) {
      out.push(edge(`var:${v.id} > ${state}`, v.id, state, VARIABLE_HANDLE.out, HANDLE.targetBind));
    }
  }
  return out;
}
