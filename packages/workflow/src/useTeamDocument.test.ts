// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTeamDocument } from "./useTeamDocument";
import type { TeamDefDetail, WorkflowDataLayer } from "./types";

const def = {
  entry: "w",
  vars: { tone: "formal" },
  states: [
    { state: "w", handler: { kind: "agent", agent: "x" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "w", to: "done", on: "success" }],
};

function layer(o: Partial<WorkflowDataLayer> = {}) {
  let active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition: def };
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
  return { l, forkTeam, move: () => (active = { ...active, def_id: "someone-else" }) };
}

// A host passes a STABLE data layer (CanvasArea memoizes it); a new one on
// every render would reload the team on every render.
afterEach(cleanup);

describe("useTeamDocument", () => {
  it("loads the team: its name, the version it forks from, the promoted one, and what is wrong with it", async () => {
    const onLoaded = vi.fn();
    const { l } = layer();
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }, onLoaded));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(result.current).toMatchObject({ name: "blog", parentDefId: "d1", unsaved: false });
    await waitFor(() => expect(result.current.activeDefId).toBe("d1"));
    expect(result.current.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("is unsaved after an edit, saves it as a fork that clears what the draft dropped, and is saved again", async () => {
    const { l, forkTeam } = layer();
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: {} } : m)));
    expect(result.current.unsaved).toBe(true);
    let r: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      r = await result.current.save();
    });
    expect(r).toMatchObject({ ok: true, saved: { def_id: "d2", version: 2 } });
    expect((forkTeam.mock.calls[0][1] as { vars?: unknown }).vars).toEqual({});
    expect(result.current).toMatchObject({ parentDefId: "d2", unsaved: false });
  });

  it("saves and checks again after its own save, on a runtime that does not make a saved version active", async () => {
    // Regression: loomcycle's fork does not promote. The stale-parent check
    // compared the ACTIVE version with the version just SAVED, so after one
    // save every later save and check was refused as "this team moved on".
    const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition: def };
    let n = 1;
    const forkTeam = vi.fn(async () => ({ def_id: `d${++n}`, name: "blog", version: n }));
    const verifyTeam = vi.fn(async () => ({ valid: true, runnable: true, issues: [] }));
    const { l } = layer({ getActiveTeamDef: async () => active, forkTeam, verifyTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: { tone: "warm" } } : m)));
    let r1: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => void (r1 = await result.current.save()));
    expect(r1!).toMatchObject({ ok: true, saved: { def_id: "d2" } });
    expect(result.current.parentDefId).toBe("d2");

    expect(await result.current.check()).toMatchObject({ ok: true });
    // Checked as a fork of what a save forks: the active version.
    expect((verifyTeam.mock.calls[0] as unknown as [string, { parentDefId: string }])[1].parentDefId).toBe("d1");

    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: { tone: "dry" } } : m)));
    let r2: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => void (r2 = await result.current.save()));
    expect(r2!).toMatchObject({ ok: true, saved: { def_id: "d3" } });
  });

  it("makes the version it saved the team's active one", async () => {
    const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition: def };
    const forkTeam = vi.fn(async () => ({ def_id: "d2", name: "blog", version: 2 }));
    // As the runtime: only a promote moves the active version.
    const promoteTeam = vi.fn(async (defId: string) => void (active.def_id = defId));
    const { l } = layer({ getActiveTeamDef: async () => active, forkTeam, promoteTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: { tone: "warm" } } : m)));
    let r: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => void (r = await result.current.save()));
    expect(r!).toEqual({ ok: true, saved: { def_id: "d2", name: "blog", version: 2 }, active: true });
    expect(promoteTeam).toHaveBeenCalledWith("d2");
    await waitFor(() => expect(result.current.activeDefId).toBe("d2"));
    // And the next save forks from it without a false "moved on".
    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: { tone: "dry" } } : m)));
    expect(await result.current.save()).toMatchObject({ ok: true, active: true });
  });

  it("reports a version that was saved but could not be made active, as a save that happened", async () => {
    const forkTeam = vi.fn(async () => ({ def_id: "d2", name: "blog", version: 2 }));
    const promoteTeam = vi.fn(async () => Promise.reject(new Error("403 insufficient_scope")));
    const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition: def };
    const { l } = layer({ getActiveTeamDef: async () => active, forkTeam, promoteTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    let r: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => void (r = await result.current.save()));
    expect(r!).toEqual({ ok: true, saved: { def_id: "d2", name: "blog", version: 2 }, active: false, activeError: "403 insufficient_scope" });
    expect(result.current).toMatchObject({ parentDefId: "d2", unsaved: false });
  });

  it("still refuses after its own save when someone else has promoted another version", async () => {
    const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition: def };
    const forkTeam = vi.fn(async () => ({ def_id: "d2", name: "blog", version: 2 }));
    const { l } = layer({ getActiveTeamDef: async () => active, forkTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    await act(async () => void (await result.current.save()));
    active.def_id = "someone-else";
    expect(await result.current.save()).toMatchObject({ ok: false, error: expect.stringMatching(/moved on/) });
    expect(forkTeam).toHaveBeenCalledTimes(1);
  });

  it("refuses to save over a version someone else promoted meanwhile", async () => {
    const { l, forkTeam, move } = layer();
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    move();
    let r: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      r = await result.current.save();
    });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/moved on while you were editing/) });
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it("reports a team it cannot load, without throwing", async () => {
    const { l } = layer({ getActiveTeamDef: async () => Promise.reject(new Error("404")) });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "nope" }));
    await waitFor(() => expect(result.current.loadError).toBe("Failed to load: 404"));
    expect(result.current.model).toBeNull();
  });

  it("starts a new team from a template: no name, no parent, unsaved, and not saveable as a version", async () => {
    const getActiveTeamDef = vi.fn();
    const { l } = layer({ getActiveTeamDef });
    const { result } = renderHook(() => useTeamDocument(l, { template: def }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(result.current).toMatchObject({ name: null, parentDefId: null, unsaved: true });
    expect(result.current.model!.nodes.map((n) => n.id)).toEqual(["w", "done"]);
    expect(await result.current.save()).toEqual({ ok: false, error: "No team loaded." });
    expect(getActiveTeamDef).not.toHaveBeenCalled();
  });

  it("saves a new team under its name, layout included, and is that team from then on", async () => {
    const createTeam = vi.fn(async (name: string) => ({ def_id: "n1", name, version: 1 }));
    const { l, forkTeam } = layer({ createTeam });
    const { result } = renderHook(() => useTeamDocument(l, { template: def }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    let r: Awaited<ReturnType<typeof result.current.saveAs>>;
    await act(async () => void (r = await result.current.saveAs("press")));
    expect(r!).toEqual({ ok: true, saved: { def_id: "n1", name: "press", version: 1 } });
    const [name, sent] = createTeam.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("press");
    expect(sent).toMatchObject({ entry: "w", vars: { tone: "formal" } });
    expect(Object.keys((sent.layout as { nodes: object }).nodes)).toEqual(["w", "done"]);
    expect(result.current).toMatchObject({ name: "press", parentDefId: "n1", activeDefId: "n1", unsaved: false });
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it("refuses to save as a name that is taken or outside the grammar, creating nothing", async () => {
    const createTeam = vi.fn(async (name: string) => ({ def_id: "n1", name, version: 1 }));
    const { l } = layer({ createTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(await result.current.saveAs("blog")).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(await result.current.saveAs("my team")).toMatchObject({ ok: false, error: expect.stringMatching(/one segment/) });
    expect(createTeam).not.toHaveBeenCalled();
    expect(result.current.name).toBe("blog");
  });

  it("checks the draft with the runtime, sending what a save would send and saving nothing", async () => {
    const verifyTeam = vi.fn(async () => ({ valid: true, runnable: true, issues: [] }));
    const { l, forkTeam } = layer({ verifyTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    // Drop the variables: a save clears them with `vars: {}`, and so must the check.
    act(() => result.current.setModel((m) => (m ? { ...m, varsPatch: {} } : m)));
    const r = await result.current.check();
    expect(r).toEqual({ ok: true, check: { valid: true, runnable: true, issues: [] } });
    const [name, draft] = verifyTeam.mock.calls[0] as unknown as [string, { overlay: Record<string, unknown>; as: string; parentDefId: string }];
    expect(name).toBe("blog");
    expect(draft).toMatchObject({ as: "fork", parentDefId: "d1" });
    expect(draft.overlay.vars).toEqual({});
    expect(forkTeam).not.toHaveBeenCalled();
    // The same overlay a save sends.
    await act(async () => void (await result.current.save()));
    expect(forkTeam.mock.calls[0][1]).toEqual(draft.overlay);
  });

  it("checks a team that is not stored yet as the create its first save will be", async () => {
    const verifyTeam = vi.fn(async () => ({ valid: true }));
    const { l } = layer({ verifyTeam });
    const { result } = renderHook(() => useTeamDocument(l, { template: def }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    await result.current.check();
    const [, draft] = verifyTeam.mock.calls[0] as unknown as [string, { overlay: Record<string, unknown>; as: string }];
    expect(draft.as).toBe("create");
    expect(draft.overlay).toMatchObject({ entry: "w" });
  });

  it("does not check over a version someone else promoted, or on a host that cannot check", async () => {
    const verifyTeam = vi.fn(async () => ({ valid: true }));
    const { l, move } = layer({ verifyTeam });
    const { result } = renderHook(() => useTeamDocument(l, { teamName: "blog" }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    move();
    expect(await result.current.check()).toMatchObject({ ok: false, error: expect.stringMatching(/moved on/) });
    expect(verifyTeam).not.toHaveBeenCalled();

    const plain = layer();
    const { result: r2 } = renderHook(() => useTeamDocument(plain.l, { teamName: "blog" }));
    await waitFor(() => expect(r2.current.model).not.toBeNull());
    expect(await r2.current.check()).toMatchObject({ ok: false, error: expect.stringMatching(/cannot check/) });
  });
});
