// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { SavedTeam, TeamDefDetail, WorkflowDataLayer } from "./types";

// The Decision node on the canvas (loomcycle 1.109, RFC ED): its questions
// are edited in the Inspector, and its answers are its transitions.

afterEach(cleanup);

const definition = {
  entry: "triage",
  states: [
    {
      state: "triage",
      handler: {
        kind: "decision",
        about: { ticket: "{{thread.output}}" },
        questions: { route: { type: "choice", instructions: "Which team?", criteria: { billing: "invoices", support: "bugs" } } },
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

function layer() {
  const active: TeamDefDetail = { def_id: "d1", name: "desk", version: 1, definition };
  const forkTeam = vi.fn(async (_n: string, _d: unknown): Promise<SavedTeam> => ({ def_id: "d2", name: "desk", version: 2 }));
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "desk", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "desk", version: 1 }),
    forkTeam,
  };
  return { l, forkTeam };
}

async function openTriage() {
  const x = layer();
  render(<WorkflowCanvas dataLayer={x.l} teamName="desk" />);
  fireEvent.click(await screen.findByTestId("node-triage"));
  const editor = await screen.findByRole("region", { name: "Decision questions" });
  return { ...x, editor: within(editor) };
}

const errors = () => [...document.querySelectorAll(".lb-wf-below .lb-wf-finding--error")].map((e) => e.textContent);

describe("WorkflowCanvas — the Decision node", () => {
  it("opens a decision state with its questions editor, and says where each answer goes", async () => {
    const { editor } = await openTriage();
    expect((editor.getByLabelText("Instructions for question route") as HTMLTextAreaElement).value).toBe("Which team?");
    const list = editor.getByRole("list", { name: "Where each answer of route goes" });
    expect(list.textContent).toMatch(/billing → billing-desk/);
    expect(list.textContent).toMatch(/support → support-desk/);
    expect(errors()).toEqual([]);
  });

  it("keeps a renamed option's transition: the edge waits for the new answer, and the team still saves", async () => {
    const { editor, forkTeam } = await openTriage();
    const opt = editor.getByLabelText("Option 1 of question route");
    fireEvent.change(opt, { target: { value: "finance" } });
    fireEvent.blur(opt);
    await waitFor(() => expect(editor.getByRole("list", { name: "Where each answer of route goes" }).textContent).toMatch(/finance → billing-desk/));
    // Without the relabel this would be two findings: an edge for an answer
    // that cannot come, and an answer with no edge.
    expect(errors()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(forkTeam).toHaveBeenCalled());
    const saved = forkTeam.mock.calls[0][1] as typeof definition;
    expect(saved.transitions.map((t) => t.on)).toEqual(["conditional:finance", "conditional:support"]);
    expect(saved.states[0].handler.questions?.route.criteria).toEqual({ finance: "invoices", support: "bugs" });
  });

  it("flags an option added without a transition, on the node and in the editor", async () => {
    const { editor } = await openTriage();
    fireEvent.click(editor.getByRole("button", { name: "Add option" }));
    await waitFor(() => expect(errors().join(" ")).toMatch(/its answer "option" has no transition/));
    expect(editor.getByRole("list", { name: "Where each answer of route goes" }).textContent).toMatch(/option → no transition yet/);
    expect((screen.getByRole("button", { name: "Save new version" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
