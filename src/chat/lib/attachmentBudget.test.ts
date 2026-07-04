import { describe, it, expect } from "vitest";
import {
  attachmentBudget,
  estimateImageTokens,
  estimateTextTokens,
  truncateToTokens,
} from "./attachmentBudget";

describe("estimateTextTokens", () => {
  it("uses ~4 chars/token, rounding up", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});

describe("estimateImageTokens", () => {
  it("scales with pixels when dimensions are known", () => {
    expect(estimateImageTokens(1500, 1500)).toBe(3000);
  });
  it("falls back to a flat estimate without dimensions", () => {
    expect(estimateImageTokens()).toBe(1200);
  });
});

describe("attachmentBudget", () => {
  it("allows everything when the window is unknown", () => {
    expect(attachmentBudget(999999, null)).toEqual({ cap: null, used: 999999, ok: true });
    expect(attachmentBudget(10, 0).ok).toBe(true);
  });
  it("caps at a fraction of the free window", () => {
    const r = attachmentBudget(50_000, 100_000, 0.6);
    expect(r.cap).toBe(60_000);
    expect(r.ok).toBe(true);
  });
  it("rejects when over the cap", () => {
    const r = attachmentBudget(80_000, 100_000, 0.6);
    expect(r.cap).toBe(60_000);
    expect(r.ok).toBe(false);
  });
});

describe("truncateToTokens", () => {
  it("leaves short text unchanged", () => {
    expect(truncateToTokens("hello", 100)).toBe("hello");
  });
  it("truncates and marks long text", () => {
    const out = truncateToTokens("x".repeat(1000), 10); // 10 tokens ≈ 40 chars
    expect(out.startsWith("x".repeat(40))).toBe(true);
    expect(out).toContain("[truncated to fit context]");
    expect(out.length).toBeLessThan(1000);
  });
});
