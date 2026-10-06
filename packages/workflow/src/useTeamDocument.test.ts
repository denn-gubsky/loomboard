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
});
