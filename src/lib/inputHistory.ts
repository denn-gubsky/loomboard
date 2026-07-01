// Terminal-style recall of previously-sent inputs in the composer. Pure so the
// navigation math is unit-tested without a DOM; the component owns the keyboard
// gating and caret handling.
//
// `history` is oldest-first (history[length-1] is the most recent send).
// `index` is a cursor: 0 means "editing the live draft" (not navigating), and
// k in [1, length] means "showing the k-th most recent entry" (1 = newest).
// `draft` preserves the in-progress text captured when navigation began, so
// stepping back down to 0 restores exactly what the user was typing.

export interface HistoryState {
  index: number;
  draft: string;
}

export type HistoryDir = "up" | "down";

export const noHistoryNav: HistoryState = { index: 0, draft: "" };

/** Step through history one entry. Returns the new cursor state and the text
 *  to show. "up" recalls older entries, "down" moves back toward the draft.
 *  A no-op (empty history, or already clamped) returns `currentText` unchanged. */
export function navigateHistory(
  history: string[],
  state: HistoryState,
  dir: HistoryDir,
  currentText: string,
): { state: HistoryState; value: string } {
  const n = history.length;
  if (n === 0) return { state, value: currentText };

  // Capture the live draft the moment we leave index 0.
  const draft = state.index === 0 ? currentText : state.draft;
  const index =
    dir === "up"
      ? Math.min(state.index + 1, n)
      : Math.max(state.index - 1, 0);

  const value = index === 0 ? draft : history[n - index];
  return { state: { index, draft }, value };
}
