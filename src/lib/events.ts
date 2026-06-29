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

export type ChatEvent = Omit<AgentEvent, "type"> & {
  type: string;
  /** Payload on `interruption_pending`. */
  interruption?: InterruptionInfo;
  /** Accumulated reasoning trace, present on `done` for some providers. */
  reasoning?: string;
};

function userInputText(payload: unknown): string {
  if (!Array.isArray(payload)) return "";
  const parts: string[] = [];
  for (const seg of payload) {
    const content =
      seg && typeof seg === "object" && "content" in seg
        ? (seg as { content?: unknown }).content
        : undefined;
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
      out.push({
        type: "user_input",
        user_input: { text: userInputText(te.payload) },
      } as ChatEvent);
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
