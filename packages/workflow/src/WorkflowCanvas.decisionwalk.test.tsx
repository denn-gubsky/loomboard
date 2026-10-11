// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { TeamDefDetail, WalkDecision, WorkflowDataLayer } from "./types";

// A decision state in Run mode. It starts no run, and a detached walk
// returns no steps: the walk's own run records each visit (loomcycle 1.110),
// and the canvas shows that record. Without one — an older runtime — it says
// which way the walk went from where the walk has been.

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

const visit: WalkDecision = {
  state: "triage",
  visit: 1,
  edge: "conditional:billing",
  next: "billing-desk",
  answer: {
    model: "decide",
    served_model: "nimble",
    answers: { route: { type: "choice", choice: "billing", probabilities: { billing: 0.91, support: 0.09 } } },
    usage: { input_tokens: 120, output_tokens: 3 },
  },
};

function layer(terminal?: string, recorded?: WalkDecision[]) {
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
  if (recorded) {
    l.watchWalkDecisions = (_walkRunId, onDecision) => {
      // Twice, as a replayed stream delivers them.
      for (const d of [...recorded, ...recorded]) onDecision(d);
      return () => undefined;
    };
  }
  return l;
}

async function walked(terminal?: string, recorded?: WalkDecision[]) {
  render(<WorkflowCanvas dataLayer={layer(terminal, recorded)} teamName="desk" />);
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
    expect(note.textContent).toMatch(/has recorded no answer for this node/);
  });

  it("shows the answer the walk recorded: the transition taken, the model, and every probability", async () => {
    const note = await walked("billing-desk", [visit]);
    const shown = await screen.findByTestId("decision-visit-1");
    expect(shown.textContent).toMatch(/The walk took conditional:billing to billing-desk\./);
    expect(shown.textContent).toMatch(/decide \(nimble\) · 120 tokens in, 3 out/);
    expect(screen.getByTestId("answer-route").textContent).toMatch(/billing 91\.0%.*support 9\.0%/);
    // The record replaces the guess, and a replayed visit is shown once.
    expect(note.textContent).not.toMatch(/It answered/);
    expect(screen.getAllByTestId(/^decision-visit-/)).toHaveLength(1);
    expect(note.textContent).toMatch(/not calibrated/);
  });

  it("keeps the latest answer on the node's face after the walk has ended", async () => {
    await walked("billing-desk", [visit]);
    await waitFor(() => expect(screen.getByTestId("decided-triage").textContent).toBe("billing 91.0% → billing-desk"));
  });

  it("numbers the visits of a state the walk passed through twice, latest first", async () => {
    await walked("billing-desk", [{ ...visit, edge: "conditional:support", next: "support-desk" }, { ...visit, visit: 4 }]);
    const shown = await screen.findAllByTestId(/^decision-visit-/);
    expect(shown.map((e) => e.getAttribute("data-testid"))).toEqual(["decision-visit-4", "decision-visit-1"]);
    expect(shown[0].textContent).toMatch(/Visit 4: the walk took conditional:billing/);
  });
});
