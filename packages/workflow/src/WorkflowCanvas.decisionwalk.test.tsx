// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { TeamDefDetail, WorkflowDataLayer } from "./types";

// A decision state in Run mode. It starts no run, and a detached walk's
// record keeps no step, so the canvas says which way the walk went from where
// the walk has been — not the model's answer, which it cannot read yet.

afterEach(cleanup);

const definition = {
  entry: "triage",
  states: [
    {
      state: "triage",
      handler: {
        kind: "decision",
        about: { ticket: "{{thread.output}}" },
        questions: { route: { type: "choice", instructions: "Which team?", criteria: { billing: null, support: null } } },
        route: "route",
      },
    },
    { state: "billing-desk", handler: { kind: "terminal" } },
    { state: "support-desk", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "triage", to: "billing-desk", on: "conditional:billing" },
    { from: "triage", to: "support-desk", on: "conditional:support" },
  ],
};

function layer(terminal?: string) {
  const active: TeamDefDetail = { def_id: "d1", name: "desk", version: 1, definition };
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "desk", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "desk", version: 1 }),
    forkTeam: async () => ({ def_id: "d2", name: "desk", version: 2 }),
    runTeamDetached: async () => ({ run_id: "r_walk", status: "running" }),
    // The walk's own run ends at once; a decision state has no member run.
    watchWalk: (walkRunId, onRows) => {
      onRows([{ runId: walkRunId, agentId: "a_walk", agent: "team:desk", status: "completed", ts: "2026-10-09T10:00:00Z" }]);
      return () => undefined;
    },
    readRun: async (runId) => ({ runId, status: "completed", finalText: "the ticket", terminal }),
  };
  return l;
}

async function walked(terminal?: string) {
  render(<WorkflowCanvas dataLayer={layer(terminal)} teamName="desk" />);
  await screen.findByTestId("node-triage");
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await screen.findByTestId("walk-id");
  fireEvent.click(screen.getByTestId("node-triage"));
  return screen.findByTestId("decision-walk-note");
}

describe("WorkflowCanvas — a decision state in a walk", () => {
  it("says which answer the walk took, from the end it reached", async () => {
    const note = await walked("billing-desk");
    await waitFor(() => expect(note.textContent).toMatch(/It answered billing: the walk went on to billing-desk\./));
    // Not "has started no run yet": a decision never starts one.
    expect(note.textContent).toMatch(/A decision node starts no run/);
    expect(screen.queryByText(/has started no run in this walk yet/)).toBeNull();
  });

  it("does not guess when the walk reached none of its transitions' targets", async () => {
    const note = await walked(undefined);
    expect(note.textContent).not.toMatch(/It answered/);
    expect(note.textContent).toMatch(/probabilities are not on the walk's record yet/);
  });
});
