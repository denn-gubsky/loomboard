import { useEffect, useRef } from "react";

// Auto-recap the active chat, the way Claude Code summarizes a long session while
// you're away: when the chat sits idle for `idleMs`, refresh its stored History
// recap so the sidebar shows an up-to-date summary. `recap` is live-safe and
// idempotent.
//
// Idle is keyed on `lastActivity` (the History row's last-activity ms): the timer
// re-arms whenever it advances (a new turn) and fires `idleMs` after the last
// one. The recap op only writes the summary — it does NOT bump last_activity — so
// recapping can't re-trigger itself. We deliberately do NOT gate on the run's
// "running" status: a parked interactive run still reports "running" in the
// aggregate feed, which would make the chat look perpetually busy and the recap
// would never fire (the bug this replaces).

export function useAutoRecap(params: {
  /** The active chat's session, or undefined when there's no sent active chat. */
  sessionId?: string;
  /** The chat's last-activity timestamp (ms). Advances on every new turn. */
  lastActivity: number;
  recap: (sessionId: string) => Promise<void>;
  idleMs?: number;
}): void {
  const { sessionId, lastActivity, recap, idleMs = 180_000 } = params;
  // The lastActivity we recapped at, per session — re-recap only after NEW
  // activity, and don't lose the mark when switching chats.
  const recappedAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!sessionId || !lastActivity) return;
    // Already summarized at (or after) this activity → nothing new to recap.
    if ((recappedAt.current.get(sessionId) ?? 0) >= lastActivity) return;

    const t = setTimeout(() => {
      // Mark before firing so a re-render mid-request can't double-arm.
      recappedAt.current.set(sessionId, lastActivity);
      void recap(sessionId);
    }, idleMs);
    return () => clearTimeout(t);
  }, [sessionId, lastActivity, recap, idleMs]);
}
