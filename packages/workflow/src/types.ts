// The package's public contract.
//
// WHY a WorkflowDataLayer instead of taking a LoomcycleClient: this component
// has two hosts with different plumbing — loomboard wires it to
// @loomcycle/client, while loomcycle's own web console wires it to that app's
// hand-rolled api.ts. Depending on the SDK would force one host to adopt the
// other's data layer and would pin this package to a client version it has no
// opinion about. Copying @loomcycle/def-fields' stance: presentational, plus a
// narrow injected interface.
//
// The shapes below are structural mirrors of the /v1/_teamdef wire, declared
// here rather than imported so the package stays SDK-free. They are
// deliberately loose where the wire is loose — `definition` really is
// arbitrary JSON, and pretending otherwise is what the passthrough model
// exists to avoid.

import type { ReactNode } from "react";
import type { WalkRunRow } from "./lib/runs";
import type { ChannelMessage } from "./lib/output";

/** One team's roll-up — GET /v1/_teamdef/names. */
export interface TeamSummary {
  name: string;
  version_count?: number;
  active_def_id?: string;
  latest_version?: number;
  last_updated?: string;
  active_retired?: boolean;
}

/** One stored version — TeamDef op=get. `definition` is the graph, verbatim. */
export interface TeamDefDetail {
  def_id: string;
  name: string;
  version: number;
  retired?: boolean;
  content_sha256?: string;
  definition: unknown;
}

/** One problem the runtime found in an unsaved team — TeamDef op=verify with
 *  an overlay (loomcycle 1.105). Mirrors the SDK's TeamIssue. */
export interface TeamCheckIssue {
  /** A wire enum that only grows; never switched on exhaustively. */
  kind: string;
  /** `refused`: a save would be refused, and `detail` is that refusal.
   *  `unrunnable`: it would be stored, but a walk could not run it.
   *  `advisory`: stops nothing. */
  severity: "refused" | "unrunnable" | "advisory" | (string & {});
  detail: string;
  /** JSON path of the value at fault, e.g. `states[2].handler.sink.channel`. */
  path?: string;
  /** The state the problem is in. */
  state?: string;
}

/** The runtime's answer about an unsaved team. Nothing was written. */
export interface TeamCheck {
  /** A create or fork with this overlay would be accepted. */
  valid: boolean;
  /** Valid, and a walk could run it. */
  runnable?: boolean;
  checked_as?: string;
  issues?: TeamCheckIssue[];
}

/** The identifiers a create/fork returns. */
export interface SavedTeam {
  def_id: string;
  name: string;
  version: number;
}

/** One executed state in a walk trace — TeamDef op=run `steps[]`. */
export interface TeamRunStep {
  state?: string;
  handler?: string;
  agent?: string;
  edge?: string;
  next?: string;
  output?: string;
  [extra: string]: unknown;
}

/** What a DETACHED start returns — immediately, while the walk runs on.
 *
 *  RFC CZ decision C8: the canvas always detaches. A synchronous `op=run`
 *  reports nothing until the walk is over, which leaves no moment at which an
 *  operator can abort it, watch a wave, answer a pause or arm a breakpoint —
 *  and only the last of those is Debug. `run_id` is the handle all of them
 *  address. */
export interface DetachedRun {
  run_id: string;
  /** Always "running" — the walk has been started, not awaited. */
  status?: string;
  name?: string;
  def_id?: string;
}

/** The result of a walk. `status` is "completed" or "iteration_cap"; the
 *  capped case names the state that tripped, which the canvas draws as the
 *  stall point rather than as a success path. */
export interface TeamRunResult {
  name?: string;
  def_id?: string;
  status?: string;
  final_state?: string;
  final_output?: string;
  capped_state?: string;
  max_iterations?: number;
  iteration_count?: number;
  steps?: TeamRunStep[];
  [extra: string]: unknown;
}

/** One declared channel, as the canvas needs to reason about it before
 *  publishing. Mirrors the fields of `/v1/channels` this surface uses.
 *
 *  `scope` matters more than it looks: a team walk resolves a channel at the
 *  scope the CHANNEL declares, not the caller's, and the runtime refuses an
 *  `agent`-scoped channel to a workflow outright — "a starter reads on the
 *  WALK's behalf, not as one agent". So the composer can tell an operator that
 *  a publish will never arrive, before they send it. */
export interface ChannelInfo {
  name: string;
  /** global | tenant | user | agent. */
  scope?: string;
  /** Publishes are stored but never delivered until released (ChannelDef.Hold). */
  hold?: boolean;
  /** Names of the channel's own `channel_publish` hooks (RFC DK D6). Each
   *  message is stored and delivered only if they release it. NAMES ONLY —
   *  never an inline webhook's URL or headers. */
  hooks?: string[];
  /** Everything stored, including the two counts below. */
  message_count?: number;
  /** Stored but invisible to readers until a release (Hold). */
  held_count?: number;
  /** Stored but invisible to readers until the channel's hooks decide. */
  awaiting_hooks_count?: number;
  source?: string;
}

/** What a publish reports back that changes what "sent" means. Mirrors the
 *  fields of the SDK's ChannelPublishResult the composer acts on. */
/** One run's outcome (RFC DI): what it answered and what it cost. */
export interface RunDetail {
  runId: string;
  status: string;
  /** The run's final answer, as text. Untrusted model output: render it as
   *  text, never as markup. */
  finalText?: string;
  /** The output_format result, when the run had one. */
  structured?: Record<string, unknown>;
  /** A walk's run only: the End (terminal) state it reached. Absent when the
   *  walk failed or was cancelled, and on every agent run. */
  terminal?: string;
  error?: string;
  stopReason?: string;
  startedAt?: string;
  completedAt?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** The prompt a run was sent, flattened to text. An image block is noted by
 *  its media type rather than dropped silently. */
export interface RunPrompt {
  system: string;
  input: string;
}

export interface PublishOutcome {
  /** Stored, not delivered until the hold is released. */
  held?: boolean;
  /** Stored, delivered only if the channel's hooks release it. */
  awaiting_hooks?: boolean;
  /** How many of the oldest messages this write trimmed (max_messages). */
  dropped_oldest?: number;
}

/** A document as a picker lists it. */
export interface DocumentOption {
  id: string;
  title: string;
}

/** A chunk as a picker needs it. */
export interface ChunkRowLite {
  id: string;
  title: string;
  position: number;
  parent_id?: string | null;
}

/** Everything the canvas needs from its host. Optional members degrade the UI
 *  rather than breaking it: no `listAgents` means the agent field is free text
 *  instead of a picker; no `runTeamDetached` hides the Run affordance. */
export interface WorkflowDataLayer {
  listTeams(): Promise<TeamSummary[]>;
  /** Resolve a team's ACTIVE version. Hosts that only have get-by-def_id can
   *  implement this as listTeams + getTeamDef. */
  getActiveTeamDef(name: string): Promise<TeamDefDetail>;
  getTeamDef(defId: string): Promise<TeamDefDetail>;
  createTeam(name: string, definition: unknown): Promise<SavedTeam>;
  /** Save an edited graph as a NEW version. The canvas always forks rather
   *  than mutating in place — a definition other runs may be using is not
   *  ours to overwrite. */
  forkTeam(name: string, definition: unknown): Promise<SavedTeam>;
  /** Make one version the team's ACTIVE one — what a run of the team by
   *  name executes. The canvas calls it after every save, because loomcycle's
   *  fork leaves the new version inactive. Optional: a host whose own
   *  `forkTeam` already promotes can leave it out. */
  promoteTeam?(defId: string): Promise<unknown>;
  /** Check an unsaved team with the runtime, writing nothing: `overlay` is
   *  exactly what createTeam / forkTeam would be sent. Optional — without it
   *  the canvas offers no Check, only its own findings. */
  verifyTeam?(
    name: string,
    draft: { overlay: unknown; as?: "create" | "fork"; parentDefId?: string },
  ): Promise<TeamCheck>;
  /** Agent names for the inspector's picker. */
  listAgents?(): Promise<string[]>;
  /** Start a walk DETACHED and return its handle at once (decision C8).
   *
   *  Deliberately the ONLY run entry point: a synchronous variant would be a
   *  second way to do the same thing whose result the canvas cannot act on.
   *
   *  A runtime older than loomcycle #1206 REFUSES `mode: "detach"` rather than
   *  running inline, which is what lets the canvas detect it without sniffing
   *  a version — the rejection is the signal, so hosts must let it through
   *  rather than falling back to a blocking run. */
  runTeamDetached?(target: {
    name?: string;
    defId?: string;
    input?: string;
    /** Values for the team's declared variables, for this walk only (RFC DV).
     *  Only those the person changed: a default is not repeated. */
    vars?: Record<string, string>;
  }): Promise<DetachedRun>;

  /** The documents a form's document picker offers (`x-loomcycle-picker:
   *  {kind: "document"}`). Absent: the field is typed. */
  listDocuments?(opts: { scope: "user" | "tenant"; underPath?: string }): Promise<DocumentOption[]>;
  /** One document's chunks, for a chunk picker. Flat, with parent ids; the
   *  canvas orders and depth-limits them (lib/inputForm.ts chunkOptions). */
  listChunks?(documentId: string, opts: { scope: "user" | "tenant" }): Promise<ChunkRowLite[]>;

  /** Stop a live walk — running or parked — by its run id (RFC CZ C16).
   *
   *  `stopped: false` means the runtime found nothing in flight to stop: the
   *  walk had already ended. Hosts must let a refusal through rather than
   *  reporting success — an older runtime (before loomcycle #1341) answers a
   *  walk's cancel with 409, and the canvas has to say the walk is still going. */
  cancelWalk?(runId: string, reason: string): Promise<{ stopped: boolean }>;

  /** Follow one walk (RFC CZ M3): hydrate its runs, then stream their
   *  transitions, until the returned function is called. Rows may arrive in
   *  any order and repeat — lib/runs.ts `foldWalk` is built for that. The
   *  host reconnects on its own; `onError` only reports, it does not stop. */
  /** Follow ONE member run's conversation while it runs (Run mode's live
   *  lines on an agent node): the last few lines, re-sent as they change,
   *  until the returned function is called. */
  watchRunLines?(runId: string, onLines: (lines: RunLine[]) => void, onError?: (e: unknown) => void): () => void;

  watchWalk?(
    walkRunId: string,
    onRows: (rows: WalkRunRow[]) => void,
    onError?: (e: unknown) => void,
  ): () => void;

  /** One run's outcome, read from the Run itself (RFC DI) — for a member
   *  row in the inspector and for the walk's own result. */
  readRun?(runId: string): Promise<RunDetail>;

  /** One Document chunk, by id — for a result that names the chunk a team
   *  wrote. Rejects when the caller cannot read it. */
  readChunk?(id: string): Promise<ChunkContent>;

  /** The exact prompt a run was sent (RFC DI `/prompt`), text blocks only. */
  readRunPrompt?(runId: string): Promise<RunPrompt>;

  /** Non-destructive read of a channel — never advances its cursor, so the
   *  canvas showing a team's output cannot take a message from the consumer
   *  it is for. `scope` is the channel's own declared scope, as for publish. */
  peekChannel?(channel: string, opts: { scope: string; max?: number }): Promise<ChannelMessage[]>;

  /** Declared channels, for the publish composer's pre-flight (C7). */
  listChannels?(): Promise<ChannelInfo[]>;
  /** The SAVED team's own channels (`./name`, RFC DV), each under its local
   *  name (`journal`), with its counts (loomcycle 1.108). The runtime keeps
   *  these out of `listChannels`. Optional: without it the canvas shows no
   *  backlog for a team's own channel. */
  listTeamChannels?(team: string): Promise<ChannelInfo[]>;
  /** Read one of the team's own channels without consuming anything. `name`
   *  is the local name. Optional: without it the Output panel says the
   *  channel cannot be read from outside the team. */
  peekTeamChannel?(team: string, name: string, opts: { max?: number }): Promise<ChannelMessage[]>;

  /** Publish one message to a channel — how an SDLC run actually starts.
   *
   *  `scope` is resolved by the CANVAS from the channel's own declaration and
   *  passed through, rather than left to the host to guess: publishing at the
   *  wrong scope succeeds and then never arrives, which is the worst failure
   *  shape available here. */
  publishChannel?(
    channel: string,
    payload: unknown,
    opts: { scope: string },
  ): Promise<PublishOutcome | void>;
}

export type CanvasMode = "edit" | "readonly";

export interface WorkflowCanvasProps {
  dataLayer: WorkflowDataLayer;
  /** Which team to open. `defId` pins a specific version; `teamName` follows
   *  the active pointer. */
  teamName?: string;
  defId?: string;
  /** With neither `teamName` nor `defId`: the definition a NEW team starts
   *  from (see TEAM_TEMPLATES). It is created, under a name the operator
   *  gives, on its first save. Must be a stable reference. */
  template?: unknown;
  mode?: CanvasMode;
  /** Fired after a successful save, with the new version's identifiers. A
   *  save under a new name reports that name: the host opens it. */
  onSaved?: (saved: SavedTeam) => void;
  /** Palette default and light/dark. Defaults to the ancestor's data-theme. */
  theme?: "dark" | "light";
  className?: string;
  /** Run mode: the host's chat for one member run, shown on the right when a
   *  state that ran is selected. The package has no chat of its own — a host
   *  renders its transcript and composer. Without it, the Inspector shows. */
  renderRunChat?: (run: RunChatTarget) => ReactNode;
  /** Show a document in the host's Documents view — offered on a result that
   *  is a chunk. Without it the chunk is shown with no link. */
  onOpenDocument?: (target: DocumentTarget) => void;
}

/** A Document chunk, as the result panel shows it. `scope` is the host's own
 *  word for where it found the chunk, handed back in DocumentTarget. */
export interface ChunkContent {
  id: string;
  title: string;
  /** Markdown source. Untrusted: render as text. */
  body: string;
  documentId: string;
  scope?: string;
}

/** What "Open in Documents" asks the host to show. */
export interface DocumentTarget {
  documentId: string;
  chunkId: string;
  scope?: string;
  title?: string;
}

/** One line of a run's conversation, compact: a user turn, or one part of an
 *  assistant turn (its text, a tool it called, its thinking). */
export interface RunLine {
  role: "user" | "assistant";
  kind: "text" | "tool" | "thinking" | "notice";
  text: string;
}

/** The member run a host chat is opened on. */
export interface RunChatTarget {
  runId: string;
  agent: string;
  /** The state that started it. */
  state: string;
  /** Still running: a message reaches the agent mid-run. */
  live: boolean;
}
