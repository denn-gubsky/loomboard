// @loomboard/workflow — the TeamDef workflow canvas.
//
// Deliberately PRESENTATIONAL plus one injected interface: it has no client,
// no fetch, and no opinion about how a TeamDef is persisted. loomboard wires
// WorkflowDataLayer to @loomcycle/client; loomcycle's own web console wires it
// to that app's api.ts. Neither inherits the other's data layer, and this
// package pins no SDK version.
//
// Styles are NOT imported here — a consumer opts in with
// `import "@loomboard/workflow/styles.css"`, which keeps a host that supplies
// its own palette from having to fight ours. That stylesheet also pulls in
// @xyflow/react's, which the canvas cannot function without.

export { WorkflowCanvas } from "./WorkflowCanvas";

export { Inspector } from "./inspector/Inspector";
export type { InspectorProps } from "./inspector/Inspector";

export { StateNode } from "./nodes/StateNode";

export {
  teamHandlerRegistry,
  fieldsForKind,
  HANDLER_OMIT_IN_LIST,
} from "./inspector/registry";

// The pure core. Exported because a host embedding the canvas usually also
// needs to read a definition without rendering one — a team list showing
// state counts, a pre-save validation gate, a headless round-trip check.
export {
  fromDefinition,
  toDefinition,
  handlerOf,
  handlerAgents,
  handlerChannels,
  teamChannels,
  patchHandler,
  allowedTargets,
  isKnownKind,
  KNOWN_KINDS,
} from "./lib/model";
export type {
  CanvasEdge,
  CanvasModel,
  CanvasNode,
  Json,
  JsonObject,
  KnownKind,
  TeamChannels,
  XY,
} from "./lib/model";

export { validateModel, canSave, validateOn, validateWait, MAX_ALLOWED_ITERATIONS } from "./lib/validate";
export type { Finding, FindingLevel } from "./lib/validate";

export { autoLayout, needsAutoLayout, COLUMN_WIDTH, ROW_HEIGHT } from "./lib/layout";

// The session machine (RFC CZ C5). Exported because the rules — when the graph
// is editable, when abort is possible — are the same questions a host's own
// chrome has to answer, and two implementations of them would disagree.
export {
  INITIAL as SESSION_INITIAL,
  reduce as reduceSession,
  isLive,
  canEditGraph,
  canReturnToEdit,
  canStart,
  abortAvailability,
  statusLabel,
} from "./lib/session";
export type {
  Availability,
  EndStatus,
  SessionEvent,
  SessionMode,
  SessionState,
  WalkPhase,
} from "./lib/session";

export {
  toFlowNodes,
  toFlowEdges,
  toDataEdges,
  fanoutSummary,
  edgeClass,
  edgeId,
  dataEdgeId,
} from "./lib/flow";
export type { FlowEdge, FlowEdgeData, FlowEdgeKind, FlowNode, FlowNodeData } from "./lib/flow";

export type {
  CanvasMode,
  DetachedRun,
  SavedTeam,
  TeamDefDetail,
  TeamRunResult,
  TeamRunStep,
  TeamSummary,
  WorkflowCanvasProps,
  WorkflowDataLayer,
} from "./types";
