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

/** Everything the canvas needs from its host. Optional members degrade the UI
 *  rather than breaking it: no `listAgents` means the agent field is free text
 *  instead of a picker; no `runTeam` hides the Run affordance. */
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
  runTeam?(target: { name?: string; defId?: string; input?: string }): Promise<TeamRunResult>;
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
