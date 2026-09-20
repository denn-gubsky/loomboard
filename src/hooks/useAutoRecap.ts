import { useEffect, useRef } from "react";

// Auto-recap the active chat, the way Claude Code summarizes a long session while
// you're away: when the chat sits idle for `idleMs`, refresh its stored History
// recap so the sidebar shows an up-to-date summary. `recap` is live-safe and
// idempotent.
//
// `idleSince` is the client-side stamp of the moment the chat last went quiet
// (see lib/recapIdle) — NOT the History row's last_activity, which is pinned to
// the run's start time and never advances for a steered chat, so keying on it
// refreshed the recap exactly once per run and then looked stuck forever.
//
// The timer re-arms whenever the stamp advances (a completed turn) and fires
// `idleMs` after it. 0 means "working right now" and disarms it. The recap op
// only writes the summary and does not itself produce a turn, so recapping can't
// re-trigger itself. We deliberately do NOT gate on the run's "running" status
// from the aggregate feed: a parked interactive run still reports "running"
// there, which would make the chat look perpetually busy.

export function useAutoRecap(params: {
  /** The active chat's session, or undefined when there's no sent active chat. */
  sessionId?: string;
  /** ms since epoch when the chat went quiet; 0 while the agent is working. */
  idleSince: number;
  recap: (sessionId: string) => Promise<void>;
  idleMs?: number;
}): void {
  const { sessionId, idleSince, recap, idleMs = 180_000 } = params;
  // The stamp we recapped at, per session — re-recap only after a NEW quiet
  // spell, and don't lose the mark when switching chats.
  const recappedAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!sessionId || !idleSince) return;
    // Already summarized for this quiet spell → nothing new to recap.
    if ((recappedAt.current.get(sessionId) ?? 0) >= idleSince) return;

    const t = setTimeout(() => {
      // Mark before firing so a re-render mid-request can't double-arm.
      recappedAt.current.set(sessionId, idleSince);
      void recap(sessionId);
    }, idleMs);
    return () => clearTimeout(t);
  }, [sessionId, idleSince, recap, idleMs]);
}
