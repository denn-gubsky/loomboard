// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { locate } from "./lib/teamJson";
import type { TeamDefDetail, WorkflowDataLayer } from "./types";

// RFC DX phase 3: the JSON view and the canvas are two views of one team.
// Driven through the real CodeMirror editor, as an operator would edit.

afterEach(cleanup);

const definition = {
  entry: "write",
  states: [
    { state: "write", handler: { kind: "agent", agent: "writer" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "write", to: "done", on: "success" }],
};

function layer(o: Partial<WorkflowDataLayer> = {}) {
  let active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition };
  const forkTeam = vi.fn(async (_n: string, d: unknown) => {
    active = { def_id: `d${active.version + 1}`, name: "blog", version: active.version + 1, definition: d as TeamDefDetail["definition"] };
    return { def_id: active.def_id, name: "blog", version: active.version };
  });
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "blog", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "blog", version: 1 }),
    forkTeam,
    ...o,
  };
  return { l, forkTeam };
}

async function editor(): Promise<EditorView> {
  const host = await screen.findByTestId("json-view");
  await waitFor(() => expect(host.querySelector(".cm-editor")).not.toBeNull());
  const v = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!;
  await waitFor(() => expect(v.state.doc.length).toBeGreaterThan(0));
  return v;
}

/** Replace the whole text, as typing would: through the editor, as an edit. */
function type(v: EditorView, text: string) {
  act(() => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }));
}

const json = (v: EditorView) => JSON.parse(v.state.doc.toString());

async function open(o: Partial<WorkflowDataLayer> = {}, view: "JSON" | "Split" = "Split") {
  const l = layer(o);
  render(<WorkflowCanvas dataLayer={l.l} teamName="blog" />);
  await screen.findByTestId("node-write");
  fireEvent.click(screen.getByRole("button", { name: view }));
  return { ...l, v: await editor() };
}

describe("WorkflowCanvas — the JSON view (RFC DX)", () => {
  it("shows the team as the definition it will save, positions included, with layout folded", async () => {
    const { v } = await open();
    const shown = json(v);
    expect(shown.states).toEqual(definition.states);
    expect(Object.keys(shown.layout.nodes)).toEqual(["write", "done"]);
    // Regression: the fold was taken before the text existed, so nothing folded.
    await waitFor(() => expect(foldedRanges(v.state).size).toBe(1));
    const line = v.state.doc.lineAt(foldedRanges(v.state).iter().from);
    expect(line.text).toMatch(/"layout": \{/);
  });

  it("a canvas edit shows in the JSON, and a JSON edit shows on the canvas", async () => {
    const { v } = await open();
    // Canvas → JSON: place an agent from the palette.
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    await waitFor(() => expect(json(v).states.map((s: { state: string }) => s.state)).toContain("agent-1"));
    // JSON → canvas: rename the writer's agent.
    const t = JSON.parse(v.state.doc.toString());
    t.states[0].handler.agent = "marketing/writer";
    type(v, JSON.stringify(t, null, 2));
    await waitFor(() => expect(screen.getByTestId("node-write").textContent).toContain("marketing/writer"));
  });

  it("keeps the text the operator typed — its formatting is not regenerated under them", async () => {
    const { v } = await open();
    const compact = JSON.stringify({ ...json(v), entry: "write" });
    type(v, compact);
    await new Promise((r) => setTimeout(r, 400));
    expect(v.state.doc.toString()).toBe(compact);
  });

  it("invalid JSON freezes the canvas: a banner naming the line, no palette, and Save off — until it is fixed", async () => {
    const { v } = await open();
    const good = v.state.doc.toString();
    type(v, good.replace('"entry": "write",', '"entry": "write"'));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/line 3/);
    expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
    expect((screen.getByRole("button", { name: "Save new version" }) as HTMLButtonElement).disabled).toBe(true);
    type(v, good);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
  });

  it("an unknown kind and an unknown key typed in JSON survive a canvas edit, and are saved", async () => {
    const { v, forkTeam } = await open();
    const t = json(v);
    t.x_custom = { owner: "ops" };
    t.states.splice(1, 0, { state: "ship", handler: { kind: "from-a-newer-runtime", knob: 3 } });
    t.transitions = [
      { from: "write", to: "ship", on: "success" },
      { from: "ship", to: "done", on: "success" },
    ];
    type(v, JSON.stringify(t, null, 2));
    await screen.findByTestId("node-ship");
    // A canvas edit after it.
    fireEvent.click(screen.getByRole("button", { name: "Auto-layout" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save new version" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(forkTeam).toHaveBeenCalled());
    const saved = forkTeam.mock.calls[0][1] as Record<string, unknown>;
    expect(saved.x_custom).toEqual({ owner: "ops" });
    expect((saved.states as { state: string; handler: unknown }[])[1]).toEqual({ state: "ship", handler: { kind: "from-a-newer-runtime", knob: 3 } });
  });

  it("a finding opens its line in the JSON", async () => {
    const { v } = await open();
    const t = json(v);
    t.states[0].handler.agent = "./ghost";
    const text = JSON.stringify(t, null, 2);
    type(v, text);
    const finding = await screen.findByRole("button", { name: /names a local agent the team does not declare/ });
    fireEvent.click(finding);
    expect(v.state.selection.main.head).toBe(locate(text, ["states", 0, "handler", "agent"])!.offset);
  });

  it("is read-only while a walk is on screen", async () => {
    const { v } = await open({
      runTeamDetached: async () => ({ run_id: "r_walk", status: "running" }),
      watchWalk: () => () => undefined,
    });
    expect(v.state.readOnly).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(v.state.readOnly).toBe(true));
  });
});
