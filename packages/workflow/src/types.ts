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
  }): Promise<DetachedRun>;

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
  watchWalk?(
    walkRunId: string,
    onRows: (rows: WalkRunRow[]) => void,
    onError?: (e: unknown) => void,
  ): () => void;

  /** One run's outcome, read from the Run itself (RFC DI) — for a member
   *  row in the inspector and for the walk's own result. */
  readRun?(runId: string): Promise<RunDetail>;

  /** The exact prompt a run was sent (RFC DI `/prompt`), text blocks only. */
  readRunPrompt?(runId: string): Promise<RunPrompt>;

  /** Non-destructive read of a channel — never advances its cursor, so the
   *  canvas showing a team's output cannot take a message from the consumer
   *  it is for. `scope` is the channel's own declared scope, as for publish. */
  peekChannel?(channel: string, opts: { scope: string; max?: number }): Promise<ChannelMessage[]>;

  /** Declared channels, for the publish composer's pre-flight (C7). */
  listChannels?(): Promise<ChannelInfo[]>;

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
  mode?: CanvasMode;
  /** Fired after a successful save, with the new version's identifiers. */
  onSaved?: (saved: SavedTeam) => void;
  /** Palette default and light/dark. Defaults to the ancestor's data-theme. */
  theme?: "dark" | "light";
  className?: string;
}
