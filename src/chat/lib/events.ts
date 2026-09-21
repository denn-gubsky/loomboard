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
  /** The next-in-queue the resolver picked. ABSENT when it found no
   *  non-stalled candidate at all — the run fails next. */
  new_provider?: string;
  new_model?: string;
  /** The error CLASS that triggered the switch ("retryable"). A stable wire
   *  label, not a description of what went wrong. */
  reason?: string;
  /** Cumulative fallback counter: 1 for the first switch, 2 for the second. */
  attempt?: number;
  /** The provider's own error, truncated by the runtime to ~200 chars. This is
   *  the operator-useful half — `reason` only names the class. */
  cause_error?: string;
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

/** Payload on a `context_distill_declined` event — the runtime CROSSED its
 *  distillation threshold and then did nothing.
 *
 *  This is the event whose absence made the original problem invisible: a
 *  conversation climbed to the top of its window while recap fired and declined
 *  every turn, leaving no marker and no error, so "it never tried" and "it tried
 *  and could not" looked identical.
 *
 *  Which numbers are the evidence depends on the reason, so they are populated
 *  per reason rather than always — `messages`/`keep_last_n` diagnose
 *  `split_declined`, `before_tokens`/`after_tokens` diagnose `not_smaller`. */
export interface DistillDeclinedInfo {
  /** Which path declined: "recap" or "compaction". They read DIFFERENT config
   *  keys, so this decides which block an operator should edit. */
  mode?: string;
  /** "auto" (the threshold fired) or "self" (the agent asked). */
  trigger?: string;
  /** split_declined | empty_summary | summarize_failed | not_smaller |
   *  reasoning_keep — and possibly one this build has not heard of. */
  reason?: string;
  /** The footprint that opened the gate. Declining at 40% is housekeeping;
   *  declining at 99% is a run about to fail. */
  used_tokens?: number;
  window_tokens?: number;
  messages?: number;
  keep_last_n?: number;
  before_tokens?: number;
  after_tokens?: number;
  /** A line naming the condition and the fix. The runtime always populates it. */
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
  /** Payload on `context_compaction` — the SDK's EventType names the type but
   *  AgentEvent carries no field for it. */
  context_compaction?: DistillInfo;
  /** Payload on `context_recap` — not in the SDK's EventType union at all, but
   *  the SSE parser passes unmodelled types through with their payloads. */
  context_recap?: DistillInfo;
  /** Payload on `context_distill_declined`. Note the field is `context_distill`
   *  while the event type is `context_distill_declined` — they differ on the
   *  wire, so this is not a typo to tidy. */
  context_distill?: DistillDeclinedInfo;
  /** Accumulated reasoning trace, present on `done` for some providers. */
  reasoning?: string;
};

/** A short human-readable description of a provider fallback for an inline
 *  notice ("ollama-local/gemma4 → deepseek/deepseek-v4-flash"). */
export function describeFallback(f: FallbackInfo): string {
  const from = [f.failed_provider, f.failed_model].filter(Boolean).join("/");
  const to = [f.new_provider, f.new_model].filter(Boolean).join("/");
  // The resolver may legitimately re-pick the SAME provider/model — a tier with
  // one candidate has nowhere else to go — and the loop emits the fallback event
  // regardless. Rendering that as "Switched model: X → X" reports a switch that
  // did not happen; what happened is a retry of the same model.
  const head = !to
    ? `Model ${from || "?"} unavailable`
    : to === from
      ? `Retried ${to}`
      : `Switched model: ${from || "?"} → ${to}`;
  const attempt = f.attempt && f.attempt > 1 ? ` (attempt ${f.attempt})` : "";
  // `reason` is the error class ("retryable"); `cause_error` is what the provider
  // actually said. The class alone sits where an explanation belongs while
  // explaining nothing, so prefer the cause and keep the class as the fallback.
  const why = f.cause_error || f.reason;
  return why ? `${head}${attempt} — ${why}` : `${head}${attempt}`;
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

/** Note for a distillation that was triggered and did nothing.
 *
 *  Prefers the runtime's own line, which names both the condition and the fix —
 *  same precedence `describeLimit` uses, and for the same reason: the server
 *  knows which lever the operator should reach for and a client rebuilding that
 *  from an enum will drift from it.
 *
 *  The fallback covers an older or newer runtime that sends a reason this build
 *  has not heard of. It must never collapse to a bare "declined": the whole
 *  point of the event is that the reason is the actionable part. */
export function describeDistillDeclined(d: DistillDeclinedInfo): string {
  const at =
    d.used_tokens && d.window_tokens
      ? ` at ${Math.round((d.used_tokens / d.window_tokens) * 100)}% of the window`
      : "";
  const head = `Context ${d.mode === "recap" ? "recap" : "compaction"} declined${at}`;
  // The runtime builds `message` as "context <mode> declined: …" (loop.go's
  // compactionSummaryDecline and its siblings), so prepending our head repeated
  // that clause verbatim: "Context recap declined: context recap declined: …".
  // Strip the runtime's prefix rather than dropping our head — ours is the one
  // that can carry the "at N% of the window" urgency the runtime's text omits.
  const body = d.message?.replace(/^\s*context\s+\w+\s+declined:\s*/i, "").trim();
  if (body) return `${head}: ${body}`;

  switch (d.reason) {
    case "split_declined":
      return d.messages && d.keep_last_n
        ? `${head}: keep_last_n ${d.keep_last_n} pins all ${d.messages} messages, so there is nothing to summarize`
        : `${head}: the kept tail spans the whole conversation`;
    case "empty_summary":
      return `${head}: the summarizer returned no text`;
    case "summarize_failed":
      return `${head}: the summarize call failed`;
    case "not_smaller":
      return d.before_tokens && d.after_tokens
        ? `${head}: the summary came back no smaller (${formatCount(d.before_tokens)} → ${formatCount(d.after_tokens)})`
        : `${head}: the summary came back no smaller`;
    case "reasoning_keep":
      return `${head}: reasoning is set to keep, which turns distillation off`;
    default:
      return d.reason ? `${head}: ${d.reason}` : head;
  }
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
