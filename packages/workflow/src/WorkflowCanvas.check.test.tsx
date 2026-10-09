// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { forEachDiagnostic } from "@codemirror/lint";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { SavedTeam, TeamCheck, TeamDefDetail, WorkflowDataLayer } from "./types";

// RFC DX phase 5: Check asks the runtime what a save would meet, and shows
// the answer where the problem is — without saving anything.

afterEach(cleanup);

const definition = {
  entry: "write",
  states: [
    { state: "write", handler: { kind: "agent", agent: "ghost" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "write", to: "done", on: "success" }],
};

const unrunnable: TeamCheck = {
  valid: true,
  runnable: false,
  checked_as: "fork",
  issues: [
    {
      kind: "agent_missing",
      severity: "unrunnable",
      detail: 'agent "ghost" does not resolve in this tenant',
      path: "states[0].handler.agent",
      state: "write",
    },
  ],
};

function layer(check: TeamCheck | undefined, o: Partial<WorkflowDataLayer> = {}) {
  const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition };
  const forkTeam = vi.fn(async (_n: string, _d: unknown): Promise<SavedTeam> => {
    active.def_id = "d2";
    return { def_id: "d2", name: "blog", version: 2 };
  });
  const verifyTeam = vi.fn(async (_n: string, _d: { overlay: unknown }) => check!);
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "blog", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "blog", version: 1 }),
    forkTeam,
    ...(check ? { verifyTeam } : {}),
    ...o,
  };
  return { l, forkTeam, verifyTeam };
}

async function editor(): Promise<EditorView> {
  const host = await screen.findByTestId("json-view");
  await waitFor(() => expect(host.querySelector(".cm-editor")).not.toBeNull());
  const v = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!;
  await waitFor(() => expect(v.state.doc.length).toBeGreaterThan(0));
  return v;
}

describe("WorkflowCanvas — Check with the runtime (RFC DX)", () => {
  it("offers no Check on a host that cannot ask the runtime", async () => {
    const { l } = layer(undefined);
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
  });

  it("asks the runtime about the draft, saves nothing, and says what it found", async () => {
    const { l, verifyTeam, forkTeam } = layer(unrunnable);
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const panel = await screen.findByTestId("runtime-check");
    expect(panel.textContent).toMatch(/The runtime would save this, but a walk could not run it: 1 problem\./);
    expect(panel.textContent).toMatch(/agent "ghost" does not resolve in this tenant \(it would be saved, but could not run\)/);
    const [name, draft] = verifyTeam.mock.calls[0];
    expect(name).toBe("blog");
    expect((draft.overlay as { states: unknown }).states).toEqual(definition.states);
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it("says a clean team is accepted", async () => {
    const { l } = layer({ valid: true, runnable: true, issues: [] });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect((await screen.findByTestId("runtime-check")).textContent).toMatch(/The runtime accepts this team, and a walk could run it\./);
  });

  it("marks a runtime issue at its line in the JSON, and opens it there", async () => {
    const { l } = layer(unrunnable);
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    const v = await editor();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const panel = await screen.findByTestId("runtime-check");
    const lines = () => {
      const out: string[] = [];
      forEachDiagnostic(v.state, (d, from) => out.push(`${d.message} @ ${v.state.doc.lineAt(from).text.trim()}`));
      return out;
    };
    await waitFor(() =>
      expect(lines()).toContain('agent "ghost" does not resolve in this tenant (it would be saved, but could not run) @ "agent": "ghost"'),
    );
    fireEvent.click(panel.querySelector("button")!);
    expect(v.state.doc.lineAt(v.state.selection.main.head).text.trim()).toBe('"agent": "ghost"');
  });

  it("lists a problem the canvas already shows once, and says the runtime found it too", async () => {
    const both: TeamCheck = {
      valid: false,
      runnable: false,
      issues: [
        { kind: "graph_invalid", severity: "refused", detail: 'team definition: transition[0] has invalid `on` "failure" (want success | pushback:<reason> | conditional:<expr>)', path: "transitions[0].on" },
        unrunnable.issues![0],
      ],
    };
    const broken = { ...definition, transitions: [{ from: "write", to: "done", on: "failure" }] };
    const { l } = layer(both, { getActiveTeamDef: async () => ({ def_id: "d1", name: "blog", version: 1, definition: broken }) });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const panel = await screen.findByTestId("runtime-check");
    expect(panel.textContent).toMatch(/The runtime would refuse this save: 1 problem\./);
    expect(panel.textContent).toMatch(/1 of them is in the canvas's own list below\./);
    // Only what the canvas could not know is listed under the verdict.
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      'agent "ghost" does not resolve in this tenant (it would be saved, but could not run)',
    ]);
    expect(screen.getAllByText(/transition\[0\] (has )?invalid `on` "failure"/)).toHaveLength(1);
  });

  it("drops the answer when the team changes — it was about another draft", async () => {
    const { l } = layer(unrunnable);
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByTestId("runtime-check");
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.queryByTestId("runtime-check")).toBeNull());
  });

  it("checks once more after a save, so a saved team that cannot run says so", async () => {
    const { l, forkTeam, verifyTeam } = layer(unrunnable);
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Auto-layout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(forkTeam).toHaveBeenCalled());
    expect((await screen.findByTestId("runtime-check")).textContent).toMatch(/a walk could not run it/);
    expect(verifyTeam).toHaveBeenCalledTimes(1);
    expect(verifyTeam.mock.calls[0][1].overlay).toEqual(forkTeam.mock.calls[0][1]);
  });

  it("checks after a save, and again on demand, when the runtime leaves the saved version inactive", async () => {
    // Regression: seen on TrueNAS. loomcycle's fork does not promote, and the
    // canvas then took its own save for someone else's change — no check after
    // the save, and "this team moved on" on the next Check or Save.
    const forkTeam = vi.fn(async (_n: string, _d: unknown): Promise<SavedTeam> => ({ def_id: "d2", name: "blog", version: 2 }));
    const { l, verifyTeam } = layer(unrunnable, { forkTeam });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Auto-layout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save new version" }));
    expect((await screen.findByTestId("runtime-check")).textContent).toMatch(/a walk could not run it/);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(verifyTeam).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/moved on while you were editing/)).toBeNull();
  });

  it("shows why a check could not be made, and no stale answer", async () => {
    const { l } = layer(unrunnable, { verifyTeam: vi.fn(async () => Promise.reject(new Error("503 runtime paused"))) });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Check failed: 503 runtime paused")).toBeTruthy();
    expect(screen.queryByTestId("runtime-check")).toBeNull();
  });
});
