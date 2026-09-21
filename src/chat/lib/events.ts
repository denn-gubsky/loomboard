import type { AgentEvent, TranscriptEvent, TranscriptResponse } from "@loomcycle/client";
import { formatCount } from "./metrics";

// These wire shapes were hand-declared here for as long as the SDK did not
// carry them. Client 1.86.0 does — its own note: "a value a typed client cannot
// name is a value it is likely to drop" — so they are DERIVED from AgentEvent
// rather than re-described. One declaration per wire shape, owned by the repo
// that owns the wire, and a server-side field change now breaks the build here
// instead of being ignored at runtime.
//
// WHY indexed access rather than importing the named interfaces: 1.86.0 adds
// them to types.ts but its index.d.ts re-export is an ENUMERATED list that does
// not include them, so `import type { ContextExhaustedInfo }` does not resolve.
// AgentEvent is exported and carries every payload as a field, so indexing it
// reaches the same types through the door that is actually open — and keeps
// working unchanged once the export list catches up.
type Payload<K extends keyof AgentEvent> = NonNullable<AgentEvent[K]>;

export type InterruptionInfo = Payload<"interruption">;
export type FallbackInfo = Payload<"fallback">;
export type LimitInfo = Payload<"limit">;
export type OverrideInfo = Payload<"override">;
export type DistillDeclinedInfo = Payload<"context_distill">;
export type ContextExhaustedInfo = Payload<"context_exhausted">;
export type ContextTierVerdict = NonNullable<ContextExhaustedInfo["verdicts"]>[number];

/** A completed distillation. The two events differ only in what they call the
 *  text they produced — `summary` for compaction, `recap` for recap — and
 *  everything this UI renders (before/after/trigger) is common to both, so one
 *  union serves both call sites. */
export type DistillInfo = Payload<"context_compaction"> | Payload<"context_recap">;








export type ChatEvent = Omit<AgentEvent, "type"> & {
  /** Widened deliberately. AgentEvent's EventType now names every type the
   *  server emits, but it has twice lagged the wire this month — and a case
   *  for a type the union does not yet carry must still COMPILE, or the only
   *  way to render a new event is to cast out of the union, which is how
   *  `context_exhausted` reached a terminal that had no case for it. */
  type: string;
};


// The describe* helpers below take Partial<> of their payload deliberately.
// The SDK marks several fields required and is right to — Go emits them
// without `omitempty`, so a CURRENT runtime always sends them. But these are
// defensive renderers: they run against whatever actually arrives, including
// from a runtime older than this build, and every one of them is written to
// degrade to a shorter sentence rather than throw. Declaring the full type
// would promise a guarantee the renderer does not rely on, and would force the
// tests that prove the degradation to fabricate fields to get past the
// compiler.

/** A short human-readable description of a provider fallback for an inline
 *  notice ("ollama-local/gemma4 → deepseek/deepseek-v4-flash"). */
export function describeFallback(f: Partial<FallbackInfo>): string {
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
export function describeLimit(info: Partial<LimitInfo>): string {
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

export function describeOverride(info: Partial<OverrideInfo>): string {
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
export function describeDistill(kind: "compaction" | "recap", d: Partial<DistillInfo>): string {
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
export function describeDistillDeclined(d: Partial<DistillDeclinedInfo>): string {
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

/** The exhaustion line for the transcript.
 *
 *  The runtime's `message` is relayed VERBATIM when present, and deliberately
 *  so: it is built self-contained, carrying every tier's own wording because
 *  "the exhaustion report does not paraphrase away the fix it named". That
 *  repeats what the individual decline notices said, which is the right
 *  trade — the declines are deduped once per run, so a reader arriving at 950%
 *  may never have seen them, and must not have to scroll to learn the fix.
 *
 *  Only the fallback path composes anything, for a runtime that sends the
 *  numbers without a line. */
export function describeContextExhausted(x: Partial<ContextExhaustedInfo>): string {
  if (x.message) return capitalizeFirst(x.message);

  const pct =
    typeof x.used_pct === "number"
      ? `${x.used_pct}% of the window`
      : x.used_tokens && x.window_tokens
        ? `${Math.round((x.used_tokens / x.window_tokens) * 100)}% of the window`
        : "the window";
  const size =
    x.used_tokens && x.window_tokens
      ? ` (${formatCount(x.used_tokens)}/${formatCount(x.window_tokens)} tokens)`
      : "";
  const tiers = (x.verdicts ?? [])
    .map((v) => (v.mode && v.reason ? `${v.mode}: ${v.reason}` : v.mode))
    .filter(Boolean)
    .join("; ");
  const why = tiers ? ` — ${tiers}` : "";
  return `Context not reclaimed: ${pct}${size} is in use and distillation did not shrink it${why}`;
}

function capitalizeFirst(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
