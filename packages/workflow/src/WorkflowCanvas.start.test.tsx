// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { DetachedRun, TeamDefDetail, WorkflowDataLayer } from "./types";

// RFC EE item 5: a Start that is safe to retry (loomcycle 1.109, gap G24).

afterEach(cleanup);

const definition = {
  entry: "write",
  states: [
    { state: "write", handler: { kind: "agent", agent: "writer" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "write", to: "done", on: "success" }],
};

type Target = Parameters<NonNullable<WorkflowDataLayer["runTeamDetached"]>>[0];

function layer(runTeamDetached: (t: Target) => Promise<DetachedRun>) {
  const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition };
  const run = vi.fn(runTeamDetached);
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "blog", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "blog", version: 1 }),
    forkTeam: async () => ({ def_id: "d2", name: "blog", version: 2 }),
    runTeamDetached: run,
    // The walk's own run ends at once, so the session can go back to Edit.
    watchWalk: (walkRunId, onRows) => {
      onRows([{ runId: walkRunId, agentId: "a_walk", agent: "team:blog", status: "completed", ts: "2026-10-09T10:00:00Z" }]);
      return () => undefined;
    },
  };
  return { l, run };
}

describe("WorkflowCanvas — a Start that is safe to retry (G24)", () => {
  it("sends the same key when a start that got no answer is pressed again, so the team cannot run twice", async () => {
    let calls = 0;
    const { l, run } = layer(async () => {
      if (++calls === 1) throw new Error("504 Gateway Timeout");
      return { run_id: "r_walk", status: "running", deduplicated: true };
    });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/Could not start the run: 504 Gateway Timeout/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    const [first, second] = run.mock.calls.map((c) => c[0].idempotencyKey);
    expect(first).toMatch(/^[A-Za-z0-9:._-]{1,200}$/);
    expect(second).toBe(first);
    // The runtime answered with the walk the first attempt had started.
    expect(await screen.findByText(/had already been started by the earlier attempt; it was not started again/)).toBeTruthy();
    expect((await screen.findByTestId("walk-id")).textContent).toBe("r_walk");
  });

  it("uses a new key for the next walk once a start has come back", async () => {
    let n = 0;
    const { l, run } = layer(async () => ({ run_id: `r_${++n}`, status: "running" }));
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("walk-id");
    fireEvent.click(await screen.findByRole("button", { name: "Back to Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    const [first, second] = run.mock.calls.map((c) => c[0].idempotencyKey);
    expect(second).not.toBe(first);
  });
});
