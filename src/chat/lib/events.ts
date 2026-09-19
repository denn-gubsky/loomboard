import type { AgentEvent, TranscriptEvent, TranscriptResponse } from "@loomcycle/client";
import { formatCount } from "./metrics";

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

/** Payload on an `override` event (loomcycle RFC DC per-run overrides) — a run's
 *  own configuration changed mid-run because an operator retuned it.
 *
 *  It names what MOVED rather than what the settings now are, which is the
 *  useful half: "the configuration changed" answers nothing for someone trying
 *  to work out why the answers got different after turn 12. Declared here rather
 *  than imported because the SDK does not re-export it from the package entry
 *  (checked at 1.82.0), and declared with every field optional so it is
 *  assignable FROM the SDK's stricter shape. ChatEvent does NOT redeclare the
 *  `override` field: AgentEvent already carries it, and a second declaration
 *  intersects rather than replaces — which is what made `source` required. */
export interface OverrideInfo {
  /** Who changed it. "operator" today; present so a later automatic retune is
   *  distinguishable rather than indistinguishable. Optional here where the SDK
   *  makes it required, so this stays assignable FROM the SDK's shape and also
   *  accepts an older runtime that omits it. */
  source?: string;
  /** "provider/model" before the change. Absent when routing did not move. */
  from_model?: string;
  /** "provider/model" after the change. */
  to_model?: string;
  /** The override keys the request actually set, so a budget or tuning change
   *  that moved no model is still legible. */
  fields?: string[];
}

/** Payload on a `context_compaction` or `context_recap` event — the runtime
 *  DISTILLED the working context: it replaced an evicted span of the
 *  conversation with a summary so the next prompt fits.
 *
 *  The two carry the same shape but for the summary's field name, so one type
 *  serves both. Declared here rather than imported for the same reason as
 *  FallbackInfo and LimitInfo: the SDK types only a subset of what the SSE
 *  parser passes through, and `context_recap` is not in its EventType union at
 *  all (checked at 1.83.0). */
export interface DistillInfo {
  /** The compaction summary. Present on `context_compaction`. */
  summary?: string;
  /** The running progress recap. Present on `context_recap`. */
  recap?: string;
  before_tokens?: number;
  after_tokens?: number;
  /** How many trailing messages were kept verbatim. */
  keep_n?: number;
  keep_first?: boolean;
  /** "auto" when the runtime crossed its own threshold, "self" when the agent
   *  asked, absent on an operator's manual compaction. */
  trigger?: string;
}

export type ChatEvent = Omit<AgentEvent, "type"> & {
  type: string;
  /** Payload on `interruption_pending`. */
  interruption?: InterruptionInfo;
  /** Payload on `provider_fallback`. */
  fallback?: FallbackInfo;
  /** Payload on `limit` (token-budget crossing). */
  limit?: LimitInfo;
  /** Payload on `context_compaction` — the SDK's EventType names the type but
   *  AgentEvent carries no field for it. */
  context_compaction?: DistillInfo;
  /** Payload on `context_recap` — not in the SDK's EventType union at all, but
   *  the SSE parser passes unmodelled types through with their payloads. */
  context_recap?: DistillInfo;
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

/** Note for a mid-run retune.
 *
 *  TWO EVENTS carry this payload and one retune can produce both, so a reader
 *  has to tell them apart or the transcript gets the same change twice. The
 *  server emits one when the OPERATOR ACTS — it names the keys the request set
 *  and carries no from/to pair, because nothing has been re-resolved yet. The
 *  runtime emits one when the run ADOPTS a routing change, and that one always
 *  carries both halves of the pair. So a pair present means "the run is now
 *  using this"; a pair absent means "an operator asked for these fields".
 *
 *  We keep the ADOPTED one whenever it exists — it is the outcome, and it is
 *  what explains a change in the answers — and fall back to the request one,
 *  which is the only event a tuning-only retune produces at all.
 *
 *  Field names are shown raw (`max_tokens`, not "Output cap") — they match what
 *  the server logs and what the panel's own key chips show, and pulling the
 *  registry's labels in here would drag @loomcycle/def-fields into the core
 *  render path for a cosmetic gain. The source is named only when it is NOT the
 *  operator, because operator is the unremarkable case. */
/** Routing keys — the ones whose outcome the runtime reports separately once the
 *  run adopts them. */
const ROUTING_KEYS = new Set(["model", "provider", "tier", "effort"]);

/** Whether this frame is worth a transcript note.
 *
 *  The REQUEST frame arrives first and names the keys the operator set; the
 *  ADOPTED frame follows only if routing actually moved, and reports the pair.
 *  Posting both for a routing retune says the same change twice, in increasing
 *  order of usefulness — so a request frame that names ONLY routing keys is
 *  left to its outcome. A request that touched a budget or a tuning knob is
 *  posted, because nothing else will report it: the runtime's frame speaks for
 *  routing alone.
 *
 *  A routing request whose model resolves to what was already serving produces
 *  no adopted frame and so no note — which is correct: nothing changed. */
export function shouldPostOverride(info: OverrideInfo): boolean {
  if (info.from_model) return true; // adopted: the outcome, always worth saying
  if (!info.fields?.length) return true; // says nothing; better than silence
  return info.fields.some((f) => !ROUTING_KEYS.has(f));
}

export function describeOverride(info: OverrideInfo): string {
  const head =
    info.from_model && info.to_model
      ? `Model changed: ${info.from_model} → ${info.to_model}`
      : info.to_model
        ? `Model set to ${info.to_model}`
        : info.fields?.length
          ? `Run settings changed: ${info.fields.join(", ")}`
          : "Run settings changed";
  const by = info.source && info.source !== "operator" ? ` (by ${info.source})` : "";
  return `${head}${by}`;
}

/** Note for a distillation the runtime performed.
 *
 *  Says what it FREED, because that is the only part a reader can act on: a
 *  distillation that barely moved the number is the signal that the window is
 *  about to become a problem, and until now it was invisible either way.
 *
 *  `trigger` separates the runtime crossing its own threshold from an operator
 *  pressing the button — those look identical in a transcript otherwise, and
 *  "did it ever do this by itself?" is exactly the question that goes
 *  unanswered. */
export function describeDistill(kind: "compaction" | "recap", d: DistillInfo): string {
  const what = kind === "recap" ? "Context recapped" : "Context compacted";
  const by = d.trigger === "auto" ? " (automatic)" : d.trigger === "self" ? " (agent asked)" : "";
  const before = d.before_tokens;
  const after = d.after_tokens;
  if (typeof before !== "number" || typeof after !== "number") {
    return `${what}${by}`;
  }
  const freed = before - after;
  const tail = freed > 0 ? "" : " — no smaller";
  return `${what}${by}: ${formatCount(before)} → ${formatCount(after)} tokens${tail}`;
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
    // Interruptions are LIVE control-flow, not renderable history. Replaying a
    // historical one resurfaces an already-resolved question whose id is stale —
    // answering it 409s "interrupt does not belong to that run". A genuinely
    // pending interrupt is re-attached live on reopen (see useChat), not here.
    if (te.type === "interruption_pending") continue;
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

/** The highest event `seq` belonging to `runId` in a session transcript — the
 *  point to re-attach (streamRunByID) a tail from, so the already-rendered
 *  history isn't replayed. 0 when the run has no events here. Pure. */
export function lastSeqForRun(events: TranscriptEvent[], runId: string): number {
  let max = 0;
  for (const e of events) {
    if (e.run_id === runId && e.seq > max) max = e.seq;
  }
  return max;
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
