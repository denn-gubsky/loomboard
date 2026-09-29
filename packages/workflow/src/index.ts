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

// The channel half of what a definition REFERENCES. Separate from the
// validation mirror on purpose: the ACL check lives in the TeamDef tool's
// create/fork preflight, not in teamgraph.Validate, so a definition can fail
// one and pass the other.
export {
  channelRefs,
  channelsInUse,
  channelAllowed,
  grantList,
  requiredACL,
  aclFindings,
} from "./lib/channels";
export type { ChannelRef, ChannelSide } from "./lib/channels";
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
  toChannelFlowNodes,
  fanoutSummary,
  edgeClass,
  edgeId,
  dataEdgeId,
  CHANNEL_HANDLE,
} from "./lib/flow";
export type {
  ChannelFlowData,
  ChannelFlowNode,
  FlowEdge,
  FlowEdgeData,
  FlowEdgeKind,
  FlowNode,
  FlowNodeData,
} from "./lib/flow";

// Channel nodes: the channels a team names, drawn as the junction data edges
// route through. toDataEdges takes these views.
export { channelNodes, channelNodeId, channelBacklog, CHANNEL_NODE_PREFIX } from "./lib/channelNodes";
export type { ChannelNodeView } from "./lib/channelNodes";

// Wiring a channel by drag (M5c): what a connection to or from a channel node
// means as an edit, and which drags are refused. Exported so a host's own
// chrome applies the same rules rather than a second copy of them.
export {
  applyWire,
  connectionKind,
  placeChannel,
  planWire,
  removeChannel,
  touchesChannel,
} from "./lib/channelWiring";
export type { ConnectionKind, WireAttempt, Wiring } from "./lib/channelWiring";
export { withGrant } from "./lib/channels";

export { Palette } from "./Palette";
export type { PaletteProps } from "./Palette";

// The palette model (C11/C12). Exported because a host embedding its own
// chrome needs the same grouping and the same "external, not placeable" rule —
// two copies of that would disagree about what the canvas owns.
export {
  PALETTE,
  PALETTE_GROUPS,
  entriesInGroup,
  placeableEntries,
  newHandler,
  newStateRaw,
  nextNodeId,
} from "./lib/palette";
export type { PaletteEntry, PaletteGroup } from "./lib/palette";

export { PublishComposer } from "./PublishComposer";
export type { PublishComposerProps } from "./PublishComposer";

// The publish pre-flight (C7). Exported for the same reason the session
// machine is: a host wiring its own composer must not re-derive these rules.
export { publishOutcomeMessage, publishPreflight } from "./lib/publish";
// For a host mapping a channel's hooks onto ChannelInfo.hooks: names only.
export { hookNamesOf } from "./lib/hooks";
export type { IssueLevel, Preflight, PreflightInput, PublishIssue } from "./lib/publish";

export type {
  CanvasMode,
  ChannelInfo,
  DetachedRun,
  PublishOutcome,
  SavedTeam,
  TeamDefDetail,
  TeamRunResult,
  TeamRunStep,
  TeamSummary,
  WorkflowCanvasProps,
  WorkflowDataLayer,
} from "./types";
