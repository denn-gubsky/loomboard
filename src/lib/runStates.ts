import type { Agent, RunStateEvent } from "@loomcycle/client";

// Pure folding of the user-level run-state feed into per-run tiles. One
// `streamUserRunStates` connection drives the whole board through this; keeping
// it a pure reducer (no React, no client) makes the board logic unit-testable.

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RunTile {
  runId: string;
  agentId: string;
  /** Agent (definition) name — the display name + identity key. */
  agent: string;
  status: RunStatus;
  /** RFC3339 timestamp of the last state transition. */
  ts: string;
  error?: string;
  stopReason?: string;
  /** Filled from the hydration snapshot (Agent row); the aggregate stream frame
   *  doesn't carry it, so we preserve it across transitions. Needed to open the
   *  full <Chat> (which reloads history by sessionId) in the overlay. */
  sessionId?: string;
  parentAgentId?: string;
}

// The aggregate stream types `status` as a plain string; the runtime's
// AgentStatus enum is the closed set. Anything unrecognized is treated as
// running (a live, non-terminal run) rather than dropped.
export function normalizeStatus(s: string): RunStatus {
  switch (s) {
    case "completed":
    case "failed":
    case "cancelled":
      return s;
    default:
      return "running";
  }
}

/** Build a tile from a hydration snapshot (`listUserAgents` / `getAgent`). This
 *  is the only source of `sessionId`. */
export function tileFromAgent(a: Agent): RunTile {
  return {
    runId: a.run_id,
    agentId: a.agent_id,
    agent: a.agent,
    status: normalizeStatus(a.status),
    ts: a.completed_at ?? a.last_heartbeat_at ?? a.started_at,
    error: a.error ?? undefined,
    stopReason: a.stop_reason ?? undefined,
    sessionId: a.session_id || undefined,
    parentAgentId: a.parent_agent_id ?? undefined,
  };
}

/** Fold one transition frame into the tile map (immutable — returns a new Map).
 *  Preserves `sessionId` learned at hydration, since transition frames omit it. */
export function applyRunStateEvent(
  tiles: Map<string, RunTile>,
  ev: RunStateEvent,
): Map<string, RunTile> {
  const prev = tiles.get(ev.run_id);
  const next = new Map(tiles);
  next.set(ev.run_id, {
    runId: ev.run_id,
    agentId: ev.agent_id || prev?.agentId || "",
    agent: ev.agent || prev?.agent || "",
    status: normalizeStatus(ev.status),
    ts: ev.ts,
    error: ev.error ?? undefined,
    stopReason: ev.stop_reason ?? undefined,
    sessionId: prev?.sessionId,
    parentAgentId: ev.parent_agent_id ?? prev?.parentAgentId,
  });
  return next;
}

export type TileDisplayState =
  | "running"
  | "needs_input"
  | "done"
  | "failed"
  | "cancelled";

// The aggregate stream can't distinguish "actively generating" from "parked
// awaiting input" — both read as `running`. A pending question (from the
// interrupts poll) is what surfaces "this run needs you." Terminal states pass
// through. This is what the tile's status dot + badges render from.
export function tileDisplayState(
  tile: RunTile,
  hasPendingQuestion: boolean,
): TileDisplayState {
  switch (tile.status) {
    case "running":
      return hasPendingQuestion ? "needs_input" : "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}
