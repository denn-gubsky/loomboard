import { describe, it, expect } from "vitest";
import type { Usage } from "@loomcycle/client";
import {
  accumulateUsage,
  contextPercent,
  emptyMetrics,
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

  it("tracks the latest call's footprint as context used", () => {
    let m = emptyMetrics;
    m = accumulateUsage(m, usage({ input_tokens: 100, output_tokens: 20 }));
    m = accumulateUsage(m, usage({ input_tokens: 500, output_tokens: 60 }));
    // contextTokens reflects only the most recent call, not the sum.
    expect(m.contextTokens).toBe(560);
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
