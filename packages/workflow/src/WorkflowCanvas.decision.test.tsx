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

  it("offers no Decision lab on a host that cannot ask a decision model", async () => {
    await openTriage();
    expect(screen.queryByRole("button", { name: "Decision lab" })).toBeNull();
  });
});

describe("WorkflowCanvas — the Decision lab", () => {
  it("opens on the selected Decision node's questions, asks, and writes the questions back to the node", async () => {
    const x = layer();
    const decide = vi.fn(async () => ({ answers: { route: { type: "choice", choice: "support", probabilities: { billing: 0.2, support: 0.8 } } } }));
    render(<WorkflowCanvas dataLayer={{ ...x.l, decide }} teamName="desk" />);
    fireEvent.click(await screen.findByTestId("node-triage"));
    fireEvent.click(screen.getByRole("button", { name: "Decision lab" }));
    const lab = within(await screen.findByRole("complementary", { name: "Decision lab" }));
    // Seeded from the node, as a scratch copy.
    const instructions = lab.getByLabelText("Instructions for question route") as HTMLTextAreaElement;
    expect(instructions.value).toBe("Which team?");

    fireEvent.change(lab.getByLabelText("What the questions are about (JSON)"), { target: { value: '{"ticket": "The app crashes on login."}' } });
    fireEvent.click(lab.getByRole("button", { name: "Ask" }));
    expect((await lab.findByTestId("answer-route")).textContent).toMatch(/→ support/);
    expect(decide).toHaveBeenCalledWith({ state: { ticket: "The app crashes on login." }, questions: definition.states[0].handler.questions });

    // An edit in the lab reaches the node only through "Use on".
    fireEvent.change(lab.getByLabelText("Instructions for question route"), { target: { value: "Who should take this ticket?" } });
    expect(screen.queryByText(/were written to triage/)).toBeNull();
    fireEvent.click(lab.getByRole("button", { name: "Use on triage" }));
    expect(screen.getByText("The lab's questions were written to triage. Nothing is saved yet.")).toBeTruthy();
    fireEvent.click(lab.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(x.forkTeam).toHaveBeenCalled());
    const saved = x.forkTeam.mock.calls[0][1] as typeof definition;
    expect(saved.states[0].handler.questions?.route.instructions).toBe("Who should take this ticket?");
    // The node's route and transitions are left as they were.
    expect(saved.states[0].handler.route).toBe("route");
    expect(saved.transitions.map((t) => t.on)).toEqual(["conditional:billing", "conditional:support"]);
  });
});
