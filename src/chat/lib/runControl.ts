import type { Agent } from "@loomcycle/client";

// Cancelling a chat is `cancelAgent(agent_id)`. During a live turn we learn the
// agent_id from the stream's `agent` frame — but a REOPENED parked chat never
// attached that stream, so we must resolve the agent_id from the user's agents
// by session. cancelAgent cascades to children, so cancelling the ROOT agent
// tears down the whole run. Pure → unit-tested.

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

type CancelableAgent = Pick<
  Agent,
  "agent_id" | "session_id" | "status" | "parent_agent_id" | "started_at"
>;

/** The agent_id to cancel for `sessionId`: prefer a live (non-terminal) root
 *  agent, else the most recently started root, else fall back across all the
 *  session's agents the same way. Returns "" when the session has no agents. */
export function pickCancelableAgent(
  agents: CancelableAgent[],
  sessionId: string,
): string {
  const forSession = agents.filter((a) => a.session_id === sessionId);
  if (forSession.length === 0) return "";
  // Roots (no parent) own the run; cancelling one cascades to its children.
  const roots = forSession.filter((a) => !a.parent_agent_id);
  const pool = roots.length ? roots : forSession;
  const live = pool.find((a) => !TERMINAL.has(a.status));
  if (live) return live.agent_id;
  const newest = pool.reduce((a, b) => (a.started_at >= b.started_at ? a : b));
  return newest.agent_id;
}
