import { describe, it, expect } from "vitest";
import { isRetiredAgent, pickableAgents, type AgentEntry } from "./useAgents";

// A healthy dynamic-only agent by default (one live version); override per case.
function agent(name: string, over: Partial<AgentEntry> = {}): AgentEntry {
  return {
    name,
    source: "dynamic-only",
    in_static: false,
    in_substrate: true,
    version_count: 1,
    live_version_count: 1,
    ...over,
  };
}

describe("isRetiredAgent", () => {
  it("is true when the active version is retired", () => {
    expect(isRetiredAgent(agent("a", { active_retired: true }))).toBe(true);
  });

  it("is true for a dynamic-only agent whose every version is retired (no live count)", () => {
    // live_version_count omitempty → absent when 0.
    expect(isRetiredAgent(agent("a", { version_count: 2, live_version_count: undefined }))).toBe(true);
  });

  it("is false for a static/both agent even with no live substrate versions (static def remains)", () => {
    expect(
      isRetiredAgent(agent("a", { source: "both", in_static: true, version_count: 2, live_version_count: undefined })),
    ).toBe(false);
  });

  it("is false for a healthy agent", () => {
    expect(isRetiredAgent(agent("a"))).toBe(false);
  });
});

describe("pickableAgents", () => {
  it("hides retired agents (both retirement paths)", () => {
    const list = [
      agent("live"),
      agent("active-retired", { active_retired: true }),
      agent("all-retired", { live_version_count: undefined }),
    ];
    expect(pickableAgents(list, "").map((a) => a.name)).toEqual(["live"]);
  });

  it("keeps a retired agent when it's the current selection", () => {
    const list = [agent("live"), agent("old", { active_retired: true })];
    expect(pickableAgents(list, "old").map((a) => a.name)).toEqual(["live", "old"]);
  });

  it("returns healthy agents unchanged", () => {
    const list = [agent("a"), agent("b")];
    expect(pickableAgents(list, "a")).toEqual(list);
  });
});
