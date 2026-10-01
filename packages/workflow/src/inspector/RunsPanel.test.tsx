// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunsPanel } from "./RunsPanel";
import type { WalkRunRow } from "../lib/runs";
import type { RunDetail, RunPrompt } from "../types";

afterEach(cleanup);

const row = (o: Partial<WalkRunRow> & { runId: string }): WalkRunRow => ({
  agentId: "a",
  agent: "marketing/editor",
  status: "running",
  ts: "2026-10-01T10:00:00Z",
  ...o,
});

describe("RunsPanel", () => {
  it("says so when the node has started nothing", () => {
    render(<RunsPanel rows={[]} />);
    expect(screen.getByText(/started no run in this walk yet/)).toBeTruthy();
  });

  it("lists each run with its phase, and why a held one is held", () => {
    render(
      <RunsPanel
        rows={[
          row({ runId: "r1", status: "completed" }),
          row({ runId: "r2", awaited: "review", awaitedOn: "cite-sources", holdExpiresAt: "2026-10-02T00:00:00Z" }),
        ]}
      />,
    );
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByText(/held for review by cite-sources · rejected if unruled by 2026-10-02/)).toBeTruthy();
  });

  it("labels a revisit by the STATE's own count, and a single visit not at all", () => {
    const { rerender } = render(<RunsPanel rows={[row({ runId: "e", stateVisit: 2 })]} />);
    expect(screen.queryByText(/visit/)).toBeNull();
    rerender(<RunsPanel rows={[row({ runId: "a", stateVisit: 2 }), row({ runId: "b", stateVisit: 5 })]} />);
    expect(screen.getByText("visit 1")).toBeTruthy();
    expect(screen.getByText("visit 2")).toBeTruthy();
  });

  it("reads a run's answer from the RUN when its row is opened", async () => {
    const readRun = vi.fn(async (runId: string): Promise<RunDetail> => ({
      runId,
      status: "completed",
      finalText: "chunk_123",
      model: "m",
      inputTokens: 10,
      outputTokens: 4,
    }));
    render(<RunsPanel rows={[row({ runId: "r1", status: "completed" })]} readRun={readRun} />);
    fireEvent.click(screen.getByRole("button", { name: /completed/ }));
    expect(await screen.findByText("chunk_123")).toBeTruthy();
    expect(readRun).toHaveBeenCalledWith("r1");
    expect(screen.getByText(/10 in \/ 4 out/)).toBeTruthy();
  });

  it("loads the prompt only when its tab is opened", async () => {
    const readRun = vi.fn(async (runId: string): Promise<RunDetail> => ({ runId, status: "completed" }));
    const readRunPrompt = vi.fn(async (): Promise<RunPrompt> => ({ system: "SYS", input: "IN" }));
    render(<RunsPanel rows={[row({ runId: "r1" })]} readRun={readRun} readRunPrompt={readRunPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: /running/ }));
    await waitFor(() => expect(readRun).toHaveBeenCalled());
    expect(readRunPrompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Prompt" }));
    expect(await screen.findByText("SYS")).toBeTruthy();
    expect(screen.getByText("IN")).toBeTruthy();
  });

  it("renders an answer containing markup as TEXT, never as HTML", async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const readRun = async (runId: string): Promise<RunDetail> => ({ runId, status: "completed", finalText: evil });
    const { container } = render(<RunsPanel rows={[row({ runId: "r1", status: "completed" })]} readRun={readRun} />);
    fireEvent.click(screen.getByRole("button", { name: /completed/ }));
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});
