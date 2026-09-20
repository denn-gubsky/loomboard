// When did the active chat last go quiet? This drives the auto-recap idle timer.
//
// It exists because the server's `last_activity` CANNOT answer that question for
// a live chat. History derives last_activity as
//   MAX(completed_at WHEN set, ELSE started_at)  over the session's runs
// and loomboard deliberately keeps a whole text conversation under ONE run —
// useChat steers the live run with sendRunInput instead of starting a new one
// (see "Fast path" there). A steered run stays status=running with completed_at
// NULL for the chat's entire life, so last_activity is pinned to the moment the
// run STARTED and never advances, no matter how many turns follow.
//
// Keyed on that, the idle timer armed once and then never re-armed: the recap
// refreshed a single time per run and looked "stuck" forever after. So stamp the
// transition the client can actually see — the agent stopping work — which is
// exactly the "user went quiet" the recap is waiting for.
//
// Pure → unit-tested.

export interface IdleStamp {
  /** The chat this stamp belongs to; null when there's no active sent chat. */
  sessionId: string | null;
  /** ms since epoch when the chat went quiet, or 0 while it is still working. */
  at: number;
}

export const NO_IDLE: IdleStamp = { sessionId: null, at: 0 };

// Returns the SAME object when nothing should move the idle clock, so a caller
// holding this in state re-renders only on a real transition — and, critically,
// so an unrelated re-render (the 60s history poll) can't keep pushing the timer
// out and starve the recap.
export function nextIdleStamp(
  prev: IdleStamp,
  sessionId: string | undefined,
  running: boolean,
  now: number,
): IdleStamp {
  if (!sessionId) return prev.sessionId === null && prev.at === 0 ? prev : NO_IDLE;
  // Working: clear the stamp. This is what makes the NEXT stop produce a fresh
  // one — without the reset, a second turn would look like the first and the
  // timer would never re-arm.
  if (running) {
    return prev.sessionId === sessionId && prev.at === 0
      ? prev
      : { sessionId, at: 0 };
  }
  // Quiet, and we already stamped this chat's current quiet spell → hold, or the
  // idle countdown would restart on every render.
  if (prev.sessionId === sessionId && prev.at !== 0) return prev;
  return { sessionId, at: now };
}
