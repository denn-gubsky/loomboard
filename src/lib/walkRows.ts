import type { Agent, ParentContext, RunStateEvent } from "@loomcycle/client";
import type { WalkRunRow } from "@loomboard/workflow";

// The SDK's run shapes → the canvas's WalkRunRow. Pure, and the only place the
// app translates between the two: the package depends on no SDK, so this
// mapping is the contract between them (RFC CZ M3).

function fromContext(pc: ParentContext | undefined): Partial<WalkRunRow> {
  if (!pc) return {};
  return {
    state: pc.state || undefined,
    stateVisit: pc.state_visit,
    waveId: pc.wave_id || undefined,
    waveIndex: pc.wave_id ? pc.wave_index : undefined,
  };
}

/** A listing row (listWalkRuns / getRun). `ts` is its latest known instant:
 *  completion if it ended, otherwise its last heartbeat or start. */
export function rowFromAgent(a: Agent): WalkRunRow {
  return {
    runId: a.run_id,
    agentId: a.agent_id,
    agent: a.agent,
    status: a.status,
    ts: a.completed_at ?? a.last_heartbeat_at ?? a.started_at,
    ...fromContext(a.parent_context),
    awaited: a.awaited_state,
    awaitedOn: a.awaited_on,
    error: a.error ?? undefined,
    stopReason: a.stop_reason ?? undefined,
  };
}

/** A run-state transition (streamUserRunStates). */
export function rowFromEvent(e: RunStateEvent): WalkRunRow {
  return {
    runId: e.run_id,
    agentId: e.agent_id,
    agent: e.agent,
    status: e.status,
    ts: e.ts,
    ...fromContext(e.parent_context),
    awaited: e.awaited_state,
    awaitedOn: e.awaited_on,
    holdExpiresAt: e.hold_expires_at,
    error: e.error,
    stopReason: e.stop_reason,
  };
}

/** True when an event belongs to this walk — its own run, or one it started.
 *  Checked client-side as well as by the server's walk filter, so a server
 *  that ignored `walk_id` cannot flood the walk view with every run the user
 *  has. */
export function belongsToWalk(e: RunStateEvent, walkRunId: string): boolean {
  return e.run_id === walkRunId || e.parent_context?.walk_id === walkRunId;
}
