// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MetricsHud from "./MetricsHud";
import type { TokenMetrics } from "../lib/metrics";

afterEach(cleanup);

const base = {
  tokensPerSec: 0,
  running: false,
  servingModel: "qwen3.8:latest",
  servingProvider: "ollama-local",
};

// Modelled on the live report: a 33k window with 30k read, behind a transcript
// that has outgrown it. The header rendered "90% of 36k" — but the percentage is
// 30/33, so the figure beside it was never its denominator and 30/36 does not
// reconcile. The transcript here is 40k rather than the reported 36k because the
// report's pair sat just over the 1.2x `outgrown` gate, while 36k against 30k
// read is exactly ON it (30000 * 1.2) and renders nothing at all.
const metrics: TokenMetrics = {
  inputTokens: 318_000,
  outputTokens: 20_000,
  cacheReadTokens: 0,
  contextTokens: 30_000,
  maxContextTokens: 33_000,
};

describe("MetricsHud — the gauge denominator", () => {
  it("does not put the transcript where the window belongs", () => {
    const { container } = render(
      <MetricsHud {...base} metrics={metrics} conversationTokens={40_000} />,
    );
    // "91% of 40k" is the defect: 40k is the transcript, not the window.
    expect(container.textContent).not.toMatch(/9\d%\s*of\s*40k/);
  });

  it("labels the transcript as the transcript", () => {
    const { container } = render(
      <MetricsHud {...base} metrics={metrics} conversationTokens={40_000} />,
    );
    expect(container.textContent).toContain("transcript 40k");
    expect(screen.getByText(/91%/)).toBeTruthy();
  });

  it("still names the real window in the tooltip", () => {
    const { container } = render(
      <MetricsHud {...base} metrics={metrics} conversationTokens={40_000} />,
    );
    expect(container.textContent).toContain("the model read 30k of 33k tokens");
  });

  it("shows no transcript figure until it has clearly outgrown the prompt", () => {
    // Equal-ish numbers mean nothing is being distilled away; a second figure
    // there is noise, and a SMALLER one would look like a contradiction.
    const { container } = render(
      <MetricsHud {...base} metrics={metrics} conversationTokens={31_000} />,
    );
    expect(container.textContent).not.toContain("transcript");
  });
});
