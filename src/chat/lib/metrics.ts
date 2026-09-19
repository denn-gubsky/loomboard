import type { Usage } from "@loomcycle/client";
import type { ChatMessage } from "./eventReducer";

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
 *  across the conversation; contextTokens tracks the LATEST call's prompt (the
 *  prompt already includes prior turns, so the newest input is the footprint
 *  "right now"); maxContextTokens keeps the last reported window.
 *
 *  contextTokens counts the PROMPT ONLY — input plus whatever of it was served
 *  from cache — and deliberately not the output. The runtime computes the same
 *  quantity the same way, and its number is the one that decides whether to
 *  distil, so a UI that adds the answer on top reports a fuller window than the
 *  party acting on it believes. That gap is not cosmetic: it read 98% where the
 *  runtime saw 92%, which is how a conversation climbed to the top of its
 *  window while looking like it was already there and nothing could help. */
export function accumulateUsage(m: TokenMetrics, u: Usage): TokenMetrics {
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return {
    inputTokens: m.inputTokens + input,
    outputTokens: m.outputTokens + output,
    cacheReadTokens: m.cacheReadTokens + cacheRead,
    contextTokens: input + cacheRead,
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

/** Human duration for the reasoning scaffold: "0.4s", "3.2s", "12s", "1m 5s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + "s";
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Rough size of the visible TRANSCRIPT, in tokens.
 *
 *  It is deliberately not called the size of the prompt, and it is smaller than
 *  one: a prompt also carries the system prompt, the tool definitions and any
 *  injected memory, none of which appear in the transcript. Measured live, a
 *  session showed 24k of transcript against a 30k prompt for exactly that
 *  reason.
 *
 *  What it is FOR is the opposite comparison. Once the runtime distils, the
 *  prompt stops growing while the transcript does not, and the gap between them
 *  is the only visible evidence that distillation is working — which is the
 *  question behind "why does it keep forgetting". So it earns its place on
 *  screen only when it has clearly outgrown the prompt (see the caller); below
 *  that it is a second number that agrees with the first and explains nothing.
 *
 *  Estimated at four characters per token, the same heuristic loomcycle's own
 *  `estimateMessageTokens` uses for its distillation bookkeeping, so the two
 *  agree about what they are approximating. It overcounts dense text; treat it
 *  as an order of magnitude, which is all it is asked to be.
 *
 *  Notices are excluded: they are our own UI text and were never sent to anyone.
 */
export function estimateConversationTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.role === "user") {
      chars += m.text.length;
      continue;
    }
    for (const p of m.parts) {
      if (p.type === "text" || p.type === "thinking") chars += p.text.length;
      else if (p.type === "tool") {
        chars += p.call.name.length;
        chars += JSON.stringify(p.call.input ?? "").length;
        chars += p.call.result?.length ?? 0;
      }
    }
  }
  return Math.round(chars / 4);
}
