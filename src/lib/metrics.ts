import type { Usage } from "@loomcycle/client";

// Token accounting for the live HUD. Pure math — timing (tokens/sec) is computed
// by useChat with a wall clock and the pure helper below, so this module has no
// impure dependencies and is fully unit-tested.
export interface TokenMetrics {
  /** Cumulative prompt tokens across the conversation (▲ up). */
  inputTokens: number;
  /** Cumulative generated tokens across the conversation (▼ down). */
  outputTokens: number;
  /** Cumulative cache-read tokens (subset of input, shown for context). */
  cacheReadTokens: number;
  /** Latest provider call's footprint (input + output) ≈ current context used. */
  contextTokens: number;
  /** The serving model's context-window ceiling, when reported. */
  maxContextTokens: number;
}

export const emptyMetrics: TokenMetrics = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  contextTokens: 0,
  maxContextTokens: 0,
};

/** Fold one `usage` event into the running totals. input/output accumulate
 *  across the conversation; contextTokens tracks the LATEST call's footprint
 *  (the prompt already includes prior turns, so the newest input_tokens is the
 *  best proxy for "context used right now"); maxContextTokens keeps the last
 *  reported window. */
export function accumulateUsage(m: TokenMetrics, u: Usage): TokenMetrics {
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  return {
    inputTokens: m.inputTokens + input,
    outputTokens: m.outputTokens + output,
    cacheReadTokens: m.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
    contextTokens: input + output,
    maxContextTokens: u.max_context_tokens ?? m.maxContextTokens,
  };
}

/** Throughput in tokens/second. elapsedMs <= 0 yields 0 (avoids div-by-zero on
 *  the first frame). */
export function tokensPerSecond(outputTokens: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return (outputTokens / elapsedMs) * 1000;
}

/** Context-window usage as a 0..100 percentage, or null when the model didn't
 *  report a window (no gauge to draw). */
export function contextPercent(m: TokenMetrics): number | null {
  if (!m.maxContextTokens) return null;
  return Math.min(100, (m.contextTokens / m.maxContextTokens) * 100);
}

/** Compact a token count for the HUD: 942, 1.2k, 48k, 1.3M. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}
