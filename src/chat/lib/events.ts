import type { AgentEvent, TranscriptResponse } from "@loomcycle/client";

// The SDK's AgentEvent type models only a subset of the event types the server
// emits — the SSE parser passes through unmodeled types (e.g. "thinking",
// "interruption_pending") with their full payloads, but TypeScript doesn't know
// their fields. ChatEvent is the loosened view the reducer consumes: `type` is a
// string, plus the extra payload fields we render.
export interface InterruptionInfo {
  interrupt_id: string;
  kind: string;
  question?: string;
  /** Raw JSON from the interrupt row — an array of option strings, or a
   *  JSON-encoded string of one. Normalize with optionsToArray. */
  options?: unknown;
  context?: string;
  priority?: string;
  expires_at?: string;
}

/** Payload on a `provider_fallback` event — the loop switched providers after
 *  the picked one failed (e.g. the model was UNAVAILABLE). */
export interface FallbackInfo {
  failed_provider?: string;
  failed_model?: string;
  new_provider?: string;
  new_model?: string;
  reason?: string;
}

/** Payload on a `limit` event (loomcycle RFC AW per-scope token budgets). A
 *  `soft` crossing warns and the run continues; a `hard` crossing means the
 *  budget is reached and the next run is blocked at admission. `message` is a
 *  ready-to-show banner; the rest lets a UI render "used of limit". Typed here
 *  (not in the pinned SDK's AgentEvent) since the SSE parser passes it through. */
export interface LimitInfo {
  scope?: string;
  scope_id?: string;
  severity?: string;
  window?: string;
  used?: number;
  limit?: number;
  message?: string;
}

export type ChatEvent = Omit<AgentEvent, "type"> & {
  type: string;
  /** Payload on `interruption_pending`. */
  interruption?: InterruptionInfo;
  /** Payload on `provider_fallback`. */
  fallback?: FallbackInfo;
  /** Payload on `limit` (token-budget crossing). */
  limit?: LimitInfo;
  /** Accumulated reasoning trace, present on `done` for some providers. */
  reasoning?: string;
};

/** A short human-readable description of a provider fallback for an inline
 *  notice ("ollama-local/gemma4 → deepseek/deepseek-v4-flash"). */
export function describeFallback(f: FallbackInfo): string {
  const from = [f.failed_provider, f.failed_model].filter(Boolean).join("/");
  const to = [f.new_provider, f.new_model].filter(Boolean).join("/");
  const head = to ? `Switched model: ${from || "?"} → ${to}` : `Model ${from || "?"} unavailable`;
  return f.reason ? `${head} (${f.reason})` : head;
}

/** Banner for a token-budget crossing. Prefer the server's ready-made message;
 *  otherwise build one from the parts (so an older runtime that omits `message`
 *  still reads sensibly). */
export function describeLimit(info: LimitInfo): string {
  if (info.message) return info.message;
  const sev = info.severity === "hard" ? "hard" : "soft";
  const scope = [info.scope, info.scope_id].filter(Boolean).join(" ") || "token";
  if (typeof info.used === "number" && typeof info.limit === "number") {
    return `${scope} ${sev} token budget reached: ${info.used} of ${info.limit} tokens this month`;
  }
  return `${scope} ${sev} token budget reached`;
}

// Extract only the role:"user" text from a persisted user_input row. loomcycle
// stores the first turn's input as [{role:"system", <resolved system prompt>},
// {role:"user", <the message>}] — we must keep ONLY the user part, or the system
// prompt leaks into a user bubble on reload.
function userInputText(payload: unknown): string {
  if (!Array.isArray(payload)) return "";
  const parts: string[] = [];
  for (const seg of payload) {
    if (!seg || typeof seg !== "object") continue;
    if ((seg as { role?: unknown }).role !== "user") continue;
    const content = (seg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
        parts.push((c as { text: string }).text);
      }
    }
  }
  return parts.join("");
}

/** Convert a fetched transcript into the same event sequence the live stream
 *  yields, so reload runs through the identical reducer. Persisted events carry
 *  the SSE shape under `event`; user_input carries its segments under `payload`.
 *  system_prompt is skipped (not rendered). Pure → unit-tested. */
export function transcriptToEvents(t: TranscriptResponse): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const te of t.events) {
    if (te.type === "system_prompt") continue;
    if (te.type === "user_input") {
      const text = userInputText(te.payload);
      // Skip rows with no user-role text (e.g. a pure system-prompt row).
      if (text) out.push({ type: "user_input", user_input: { text } } as ChatEvent);
      continue;
    }
    const base =
      te.event && typeof te.event === "object"
        ? (te.event as Record<string, unknown>)
        : {};
    out.push({ ...base, type: te.type } as ChatEvent);
  }
  return out;
}

/** Normalize an interrupt's `options` (array | JSON string | absent) to a
 *  string[]. Returns [] for free-text answers. */
export function optionsToArray(options: unknown): string[] {
  if (Array.isArray(options)) {
    return options.filter((o): o is string => typeof o === "string");
  }
  if (typeof options === "string" && options.trim()) {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed)
        ? parsed.filter((o): o is string => typeof o === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}
