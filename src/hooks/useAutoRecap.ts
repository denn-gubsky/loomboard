import { useEffect, useRef } from "react";
import { shouldRecap } from "../lib/chatIndex";

// Auto-recap the active chat, the way Claude Code summarizes a long session while
// you're away: when a long chat sits idle (you haven't replied, the agent isn't
// generating) for `idleMs`, refresh its stored History recap so the sidebar shows
// an up-to-date summary. `recap` is live-safe and idempotent, so no run gating is
// needed. Staleness is keyed on runCount (see shouldRecap) so recapping once
// can't re-trigger itself. Fires at most once per new-turns window per session.

export function useAutoRecap(params: {
  /** The active chat's session, or undefined when there's no sent active chat. */
  sessionId?: string;
  runCount: number;
  /** True while the agent is actively generating (not idle). A chat parked
   *  awaiting input counts as idle — that's the "you timed out" case we want. */
  busy: boolean;
  recap: (sessionId: string) => Promise<void>;
  idleMs?: number;
}): void {
  const { sessionId, runCount, busy, recap, idleMs = 60_000 } = params;
  // The runCount we last recapped at, per session — so we don't re-summarize a
  // chat that hasn't gained turns, and so switching chats doesn't lose the mark.
  const recappedAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!sessionId || busy) return;
    if (!shouldRecap({ runCount }, recappedAt.current.get(sessionId) ?? 0)) return;

    const t = setTimeout(() => {
      // Mark before firing so a re-render mid-request can't double-arm.
      recappedAt.current.set(sessionId, runCount);
      void recap(sessionId);
    }, idleMs);
    return () => clearTimeout(t);
  }, [sessionId, runCount, busy, recap, idleMs]);
}
