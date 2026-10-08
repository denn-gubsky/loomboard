import { describe, expect, it } from "vitest";
import { forkOverlay } from "./fork";
import type { JsonObject } from "./model";

const graph = { entry: "s", states: [{ state: "s", handler: { kind: "agent", agent: "a" } }], transitions: [] };

describe("forkOverlay — what a save sends, so a dropped section is cleared, not kept from the parent", () => {
  const parent: JsonObject = {
    ...graph,
    colors: { states: { s: "#fff" } },
    layout: { nodes: { s: { x: 1, y: 2 } } },
    channels: { publish: ["out"] },
    hooks: { run_end: ["notify"] },
    vars: { tone: "formal" },
    local: { agents: { w: {} }, channels: { c: { scope: "tenant" } } },
  };

  it("sends {} for every wholesale section and local kind the parent has and the draft dropped", () => {
    expect(forkOverlay(parent, { ...graph })).toEqual({
      ...graph,
      colors: {},
      layout: {},
      channels: {},
      hooks: {},
      vars: {},
      local: { agents: {}, channels: {} },
    });
  });

  it("clears only the local kinds the draft dropped, keeping the ones it sends", () => {
    const draft = { ...graph, local: { agents: { w: { tier: "low" } } } };
    expect(forkOverlay(parent, draft).local).toEqual({ agents: { w: { tier: "low" } }, channels: {} });
  });

  it("treats null as dropped — the runtime keeps the parent's value for null too", () => {
    expect(forkOverlay(parent, { ...graph, vars: null }).vars).toEqual({});
  });

  it("sends max_iterations 0 when the parent has a cap and the draft dropped it, so the save removes the cap", () => {
    expect(forkOverlay({ ...graph, max_iterations: 12 }, { ...graph }).max_iterations).toBe(0);
    // A cap the draft states — or clears itself, with 0 or null — is sent as written.
    expect(forkOverlay({ ...graph, max_iterations: 12 }, { ...graph, max_iterations: 5 }).max_iterations).toBe(5);
    expect(forkOverlay({ ...graph, max_iterations: 12 }, { ...graph, max_iterations: null }).max_iterations).toBeNull();
    expect("max_iterations" in forkOverlay({ ...graph }, { ...graph })).toBe(false);
  });

  it("adds nothing the parent never had, sends what the draft has as it is, and leaves the draft alone", () => {
    const draft = { ...graph, vars: { tone: "warm" } };
    const out = forkOverlay({ ...graph }, draft);
    expect(out).toEqual(draft);
    const kept = forkOverlay(parent, draft);
    expect(kept.vars).toEqual({ tone: "warm" });
    expect(draft).toEqual({ ...graph, vars: { tone: "warm" } });
  });
});
