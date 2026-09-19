import { describe, it, expect } from "vitest";
import type { Usage } from "@loomcycle/client";
import {
  accumulateUsage,
  contextPercent,
  estimateConversationTokens,
  emptyMetrics,
  formatCount,
  formatDuration,
  tokensPerSecond,
} from "./metrics";

const usage = (u: Partial<Usage>): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  ...u,
});

describe("accumulateUsage", () => {
  it("accumulates input/output/cache across calls", () => {
    let m = emptyMetrics;
    m = accumulateUsage(m, usage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40 }));
    m = accumulateUsage(m, usage({ input_tokens: 130, output_tokens: 35, cache_read_input_tokens: 90 }));
    expect(m.inputTokens).toBe(230);
    expect(m.outputTokens).toBe(55);
    expect(m.cacheReadTokens).toBe(130);
  });

  it("tracks the latest call's prompt as context used", () => {
    let m = emptyMetrics;
    m = accumulateUsage(m, usage({ input_tokens: 100, output_tokens: 20 }));
    m = accumulateUsage(m, usage({ input_tokens: 500, output_tokens: 60 }));
    // Only the most recent call, not the sum — the prompt already carries the
    // prior turns.
    expect(m.contextTokens).toBe(500);
  });

  // THE AUTHORITY IS THE RUNTIME. loomcycle computes the footprint that drives
  // its distillation trigger as input + cache_read + cache_creation, with NO
  // output. Adding output here made the gauge read 98% where the runtime — the
  // party that actually decides whether to compact — saw 92%, which is how a
  // conversation climbed to the top of its window looking like it was already
  // there.
  it("counts the prompt the model read, not the answer it wrote", () => {
    const m = accumulateUsage(
      emptyMetrics,
      usage({ input_tokens: 30100, output_tokens: 2141, max_context_tokens: 32768 }),
    );
    expect(m.contextTokens).toBe(30100);
    expect(Math.round(contextPercent(m)!)).toBe(92);
  });

  it("counts cached prompt tokens, which the model still read", () => {
    const m = accumulateUsage(
      emptyMetrics,
      usage({ input_tokens: 1000, cache_read_input_tokens: 4000, output_tokens: 500 }),
    );
    expect(m.contextTokens).toBe(5000);
  });

  it("keeps the last reported context window and survives omissions", () => {
    let m = accumulateUsage(emptyMetrics, usage({ input_tokens: 10, max_context_tokens: 200000 }));
    expect(m.maxContextTokens).toBe(200000);
    // A later usage without the field must not zero it out.
    m = accumulateUsage(m, usage({ input_tokens: 20 }));
    expect(m.maxContextTokens).toBe(200000);
  });
});

describe("tokensPerSecond", () => {
  it("computes throughput", () => {
    expect(tokensPerSecond(100, 2000)).toBe(50);
  });
  it("returns 0 for non-positive elapsed", () => {
    expect(tokensPerSecond(100, 0)).toBe(0);
    expect(tokensPerSecond(100, -5)).toBe(0);
  });
});

describe("contextPercent", () => {
  it("is null when no window is reported", () => {
    expect(contextPercent(emptyMetrics)).toBeNull();
  });
  it("computes a percentage", () => {
    expect(contextPercent({ ...emptyMetrics, contextTokens: 50000, maxContextTokens: 200000 })).toBe(25);
  });
  it("clamps to 100", () => {
    expect(contextPercent({ ...emptyMetrics, contextTokens: 300000, maxContextTokens: 200000 })).toBe(100);
  });
});

describe("formatCount", () => {
  it("formats across magnitudes", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(942)).toBe("942");
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(48000)).toBe("48k");
    expect(formatCount(1_300_000)).toBe("1.3M");
  });
});

describe("formatDuration", () => {
  it("formats reasoning durations", () => {
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(12000)).toBe("12s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(-50)).toBe("0.0s");
  });
});


describe("estimateConversationTokens", () => {
  const user = (text: string) => ({ role: "user" as const, text });
  const asst = (...parts: Parameters<typeof Array>[number][]) =>
    ({ role: "assistant" as const, status: "done" as const, parts: parts as never });

  it("is zero for an empty conversation", () => {
    expect(estimateConversationTokens([])).toBe(0);
  });

  it("counts what was actually said, at four characters per token", () => {
    const m = [user("x".repeat(400)), asst({ type: "text", text: "y".repeat(800) })];
    expect(estimateConversationTokens(m)).toBe(300);
  });

  // Reasoning is sent back to the model on later turns, so it is part of what
  // the conversation weighs even though the user may never expand it.
  it("counts reasoning, which is conversation too", () => {
    const m = [asst({ type: "thinking", text: "t".repeat(400) })];
    expect(estimateConversationTokens(m)).toBe(100);
  });

  it("counts a tool call and its result", () => {
    const m = [
      asst({
        type: "tool",
        call: { id: "1", name: "Read", input: { path: "/a" }, result: "r".repeat(400) },
      }),
    ];
    // name + JSON input + result, all over four.
    expect(estimateConversationTokens(m)).toBeGreaterThan(100);
  });

  // Our own UI text was never sent to anyone; counting it would inflate the one
  // number whose whole job is to be comparable with the window.
  it("excludes notices, which are ours and not the conversation's", () => {
    const m = [asst({ type: "notice", level: "info", text: "n".repeat(4000) })];
    expect(estimateConversationTokens(m)).toBe(0);
  });

  // The point of the number: it keeps growing after the prompt stops, because
  // the runtime distils the middle away before sending. Measured live it can
  // also read SMALLER than the prompt — a prompt carries the system prompt, the
  // tool definitions and injected memory that no transcript shows — which is
  // why the caller only surfaces it once it has clearly outgrown the prompt.
  it("grows past what any single prompt would hold", () => {
    const many = Array.from({ length: 50 }, () => user("q".repeat(4000)));
    expect(estimateConversationTokens(many)).toBe(50000);
  });
});
