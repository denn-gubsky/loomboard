// Pure token-budget math for attachments, checked against the free context the
// HUD already tracks (maxContextTokens − contextTokens). Kept side-effect-free
// so it's unit-tested without a runtime.

/** ≈ tokens for a text blob (4 chars/token heuristic). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** ≈ tokens for an image. Anthropic bills roughly (w·h)/750; fall back to a
 *  flat estimate when dimensions are unknown. */
export function estimateImageTokens(width?: number, height?: number): number {
  if (width && height) return Math.ceil((width * height) / 750);
  return 1200;
}

export interface BudgetResult {
  /** Token ceiling attachments may use, or null when the window is unknown. */
  cap: number | null;
  used: number;
  ok: boolean;
}

/** Decide whether `usedTokens` of attachments fit. `freeTokens` is
 *  maxContextTokens − contextTokens; null/≤0 means the window is unknown (e.g.
 *  before the first turn, or a model that doesn't report it) — we can't enforce,
 *  so we allow. Attachments may use up to `fraction` of the free window, leaving
 *  room for the reply. */
export function attachmentBudget(
  usedTokens: number,
  freeTokens: number | null,
  fraction = 0.6,
): BudgetResult {
  if (freeTokens == null || freeTokens <= 0) {
    return { cap: null, used: usedTokens, ok: true };
  }
  const cap = Math.floor(freeTokens * fraction);
  return { cap, used: usedTokens, ok: usedTokens <= cap };
}

/** Truncate text to roughly `maxTokens`, appending a marker. Used when a single
 *  text file would blow the budget (summarization is a follow-up). */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n…[truncated to fit context]";
}
