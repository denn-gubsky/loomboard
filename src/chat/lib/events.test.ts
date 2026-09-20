import { describe, it, expect } from "vitest";
import type { TranscriptResponse } from "@loomcycle/client";
import { describeDistill, describeDistillDeclined, describeFallback, shouldPostOverride, describeOverride, lastSeqForRun, optionsToArray, transcriptToEvents } from "./events";

describe("optionsToArray", () => {
  it("passes through a string array", () => {
    expect(optionsToArray(["yes", "no"])).toEqual(["yes", "no"]);
  });
  it("parses a JSON-encoded array string", () => {
    expect(optionsToArray('["a","b"]')).toEqual(["a", "b"]);
  });
  it("returns [] for free-text / junk", () => {
    expect(optionsToArray(undefined)).toEqual([]);
    expect(optionsToArray("not json")).toEqual([]);
    expect(optionsToArray(42)).toEqual([]);
  });
});

describe("lastSeqForRun", () => {
  const events = [
    { seq: 1, run_id: "rA", ts_ns: 0, type: "text", event: {} },
    { seq: 2, run_id: "rA", ts_ns: 0, type: "done", event: {} },
    { seq: 3, run_id: "rB", ts_ns: 0, type: "text", event: {} },
    { seq: 4, run_id: "rB", ts_ns: 0, type: "done", event: {} },
  ] as unknown as TranscriptResponse["events"];

  it("returns the max seq for the run (the tail-from point)", () => {
    expect(lastSeqForRun(events, "rA")).toBe(2);
    expect(lastSeqForRun(events, "rB")).toBe(4);
  });
  it("returns 0 for a run with no events here", () => {
    expect(lastSeqForRun(events, "rC")).toBe(0);
  });
});

describe("transcriptToEvents", () => {
  it("rebuilds a turn sequence: skips system_prompt, extracts only role:user text, passes events through", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        { seq: 0, run_id: "r1", ts_ns: 0, type: "system_prompt", payload: { system_prompt: "..." } },
        {
          seq: 1,
          run_id: "r1",
          ts_ns: 1,
          type: "user_input",
          // loomcycle stores the first turn as [system prompt, user message] —
          // only the user part must survive.
          payload: [
            { role: "system", content: [{ type: "trusted-text", text: "You are AGENT." }] },
            { role: "user", content: [{ type: "trusted-text", text: "hello" }] },
          ],
        },
        { seq: 2, run_id: "r1", ts_ns: 2, type: "text", event: { type: "text", text: "hi there" } },
        { seq: 3, run_id: "r1", ts_ns: 3, type: "done", event: { type: "done", stop_reason: "end_turn" } },
      ],
    } as unknown as TranscriptResponse;

    const events = transcriptToEvents(t);
    expect(events.map((e) => e.type)).toEqual(["user_input", "text", "done"]);
    expect(events[0].user_input?.text).toBe("hello");
    expect(events[1].text).toBe("hi there");
    expect(events[2].stop_reason).toBe("end_turn");
  });

  it("skips interruption_pending rows (live control-flow; a replayed one has a stale id)", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        { seq: 0, run_id: "r1", ts_ns: 0, type: "text", event: { type: "text", text: "hi" } },
        {
          seq: 1,
          run_id: "r1",
          ts_ns: 1,
          type: "interruption_pending",
          event: { type: "interruption_pending", interruption: { interrupt_id: "i1", kind: "question", question: "?" } },
        },
        { seq: 2, run_id: "r1", ts_ns: 2, type: "done", event: { type: "done", stop_reason: "end_turn" } },
      ],
    } as unknown as TranscriptResponse;
    expect(transcriptToEvents(t).map((e) => e.type)).toEqual(["text", "done"]);
  });

  it("skips a user_input row that has no role:user text (pure system prompt)", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        {
          seq: 0,
          run_id: "r1",
          ts_ns: 0,
          type: "user_input",
          payload: [{ role: "system", content: [{ type: "trusted-text", text: "You are AGENT." }] }],
        },
      ],
    } as unknown as TranscriptResponse;
    expect(transcriptToEvents(t)).toEqual([]);
  });
});

describe("describeOverride", () => {
  it("leads with the routing move, which is what a reader is trying to explain", () => {
    expect(
      describeOverride({ source: "operator", from_model: "ollama-local/gemma4", to_model: "anthropic/claude-sonnet-5" }),
    ).toBe("Model changed: ollama-local/gemma4 → anthropic/claude-sonnet-5");
  });

  it("handles a routing set with no previous model", () => {
    expect(describeOverride({ to_model: "openai/gpt-5" })).toBe("Model set to openai/gpt-5");
  });

  it("names the keys when the change moved no model", () => {
    expect(describeOverride({ fields: ["max_tokens", "effort"] })).toBe(
      "Run settings changed: max_tokens, effort",
    );
  });

  it("still reads sensibly when the runtime sends neither", () => {
    expect(describeOverride({})).toBe("Run settings changed");
  });

  // "operator" is the unremarkable case; anything else is worth naming.
  it("names a non-operator source only", () => {
    expect(describeOverride({ fields: ["effort"], source: "operator" })).not.toContain("by");
    expect(describeOverride({ fields: ["effort"], source: "autotuner" })).toContain(
      "(by autotuner)",
    );
  });
});

describe("shouldPostOverride", () => {
  it("always posts the adopted frame — it is the outcome", () => {
    expect(shouldPostOverride({ source: "operator", from_model: "a/1", to_model: "a/2" })).toBe(true);
  });

  it("leaves a routing-only request to the frame that reports its outcome", () => {
    expect(shouldPostOverride({ source: "operator", fields: ["model"] })).toBe(false);
    expect(shouldPostOverride({ source: "operator", fields: ["tier", "effort"] })).toBe(false);
  });

  it("posts a request touching anything routing does not cover", () => {
    // Nothing else will report it: the runtime's frame speaks for routing alone.
    expect(shouldPostOverride({ source: "operator", fields: ["max_tokens"] })).toBe(true);
    expect(shouldPostOverride({ source: "operator", fields: ["model", "retry_attempts"] })).toBe(true);
  });

  it("posts a frame that names nothing rather than staying silent", () => {
    expect(shouldPostOverride({ source: "operator" })).toBe(true);
    expect(shouldPostOverride({ source: "operator", fields: [] })).toBe(true);
  });
});

describe("describeFallback", () => {
  // Observed live on chat/local: the notice read
  // "Switched model: ollama-local/qwen3.8:latest → ollama-local/qwen3.8:latest
  // (retryable)". The runtime is not wrong to emit it — ReResolve re-picked the
  // only candidate the tier has — but "switched X → X" reports a switch that
  // did not happen, and the operator-useful half (the provider's actual error)
  // was dropped in favour of the class label.
  it("calls a same-model re-pick a retry, not a switch", () => {
    expect(
      describeFallback({
        failed_provider: "ollama-local",
        failed_model: "qwen3.8:latest",
        new_provider: "ollama-local",
        new_model: "qwen3.8:latest",
        reason: "retryable",
      }),
    ).toBe("Retried ollama-local/qwen3.8:latest — retryable");
  });

  it("still reports a real switch as a switch", () => {
    expect(
      describeFallback({
        failed_provider: "anthropic",
        failed_model: "claude-opus-5",
        new_provider: "ollama-local",
        new_model: "qwen3.8:latest",
        reason: "retryable",
      }),
    ).toBe("Switched model: anthropic/claude-opus-5 → ollama-local/qwen3.8:latest — retryable");
  });

  it("prefers the provider's own error over the class label", () => {
    expect(
      describeFallback({
        failed_provider: "anthropic",
        failed_model: "claude-opus-5",
        new_provider: "ollama-local",
        new_model: "qwen3.8:latest",
        reason: "retryable",
        cause_error: "anthropic 429: rate limit exceeded",
      }),
    ).toContain("— anthropic 429: rate limit exceeded");
  });

  it("names the attempt once there has been more than one", () => {
    expect(
      describeFallback({
        failed_provider: "p",
        failed_model: "m",
        new_provider: "p",
        new_model: "m",
        attempt: 3,
        reason: "retryable",
      }),
    ).toBe("Retried p/m (attempt 3) — retryable");
  });

  it("says unavailable when the resolver found no candidate at all", () => {
    // new_* absent = the tier's candidate list was exhausted; the run fails next.
    expect(describeFallback({ failed_provider: "p", failed_model: "m", reason: "retryable" })).toBe(
      "Model p/m unavailable — retryable",
    );
  });
});

describe("describeDistill", () => {
  it("reports what the distillation freed", () => {
    expect(describeDistill("compaction", { before_tokens: 18299, after_tokens: 11676 }))
      .toBe("Context compacted: 18k → 12k tokens");
    expect(describeDistill("recap", { before_tokens: 30000, after_tokens: 9000 }))
      .toBe("Context recapped: 30k → 9.0k tokens");
  });

  // Observed live: a manual compaction whose summary cost MORE than the span it
  // replaced. formatCount rounds both sides to "14k", so without the suffix this
  // would render as a tidy no-op instead of the regression it is.
  it("names a distillation that did not shrink anything", () => {
    expect(describeDistill("compaction", { before_tokens: 14230, after_tokens: 14334 }))
      .toBe("Context compacted: 14k → 14k tokens — no smaller");
  });

  // "Did it ever do this by itself?" is the question a transcript could not
  // answer: an operator's click and the runtime's own threshold looked alike.
  it("separates the runtime's own trigger from an operator's click", () => {
    expect(describeDistill("recap", { before_tokens: 100, after_tokens: 50, trigger: "auto" }))
      .toContain("(automatic)");
    expect(describeDistill("compaction", { before_tokens: 100, after_tokens: 50, trigger: "self" }))
      .toContain("(agent asked)");
    expect(describeDistill("compaction", { before_tokens: 100, after_tokens: 50 }))
      .not.toContain("(");
  });

  it("still reads sensibly when the runtime reports no token counts", () => {
    expect(describeDistill("compaction", { summary: "x" })).toBe("Context compacted");
  });
});

describe("describeDistillDeclined", () => {
  // The runtime always populates `message` and it names the fix, so it wins —
  // same precedence describeLimit uses. A client rebuilding that line from an
  // enum drifts from the server that knows which lever to pull.
  it("prefers the runtime's own line", () => {
    expect(
      describeDistillDeclined({
        mode: "recap",
        reason: "split_declined",
        used_tokens: 23666,
        window_tokens: 32768,
        message: "keep_last_n 6 pins all 7 messages — lower it",
      }),
    ).toBe("Context recap declined at 72% of the window: keep_last_n 6 pins all 7 messages — lower it");
  });

  // Declining at 40% is housekeeping; declining at 99% is a run about to fail.
  it("says how urgent the decline is", () => {
    expect(describeDistillDeclined({ mode: "recap", used_tokens: 32352, window_tokens: 32768 }))
      .toContain("at 99% of the window");
  });

  it("names which block to edit — the two modes read different config", () => {
    expect(describeDistillDeclined({ mode: "recap" })).toContain("Context recap declined");
    expect(describeDistillDeclined({ mode: "compaction" })).toContain("Context compaction declined");
  });

  it("builds the split diagnosis from its two numbers when there is no line", () => {
    expect(describeDistillDeclined({ mode: "recap", reason: "split_declined", messages: 7, keep_last_n: 6 }))
      .toContain("keep_last_n 6 pins all 7 messages");
  });

  it("builds the not-smaller evidence from its two numbers", () => {
    expect(describeDistillDeclined({ mode: "compaction", reason: "not_smaller", before_tokens: 14230, after_tokens: 14334 }))
      .toContain("no smaller (14k → 14k)");
  });

  // The reason IS the actionable part, so an unheard-of one must survive rather
  // than collapse into a bare "declined".
  it("passes an unknown reason through", () => {
    expect(describeDistillDeclined({ mode: "recap", reason: "some_new_reason" }))
      .toBe("Context recap declined: some_new_reason");
  });
});
