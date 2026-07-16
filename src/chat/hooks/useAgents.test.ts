import { describe, it, expect } from "vitest";
import { pickableAgents, type AgentEntry } from "./useAgents";

function agent(name: string, active_retired = false): AgentEntry {
  return {
    name,
    source: "dynamic-only",
    in_static: false,
    in_substrate: true,
    version_count: 1,
    active_retired,
  };
}

describe("pickableAgents", () => {
  it("hides retired agents", () => {
    const list = [agent("live"), agent("old", true)];
    expect(pickableAgents(list, "").map((a) => a.name)).toEqual(["live"]);
  });

  it("keeps a retired agent when it's the current selection", () => {
    const list = [agent("live"), agent("old", true)];
    expect(pickableAgents(list, "old").map((a) => a.name)).toEqual(["live", "old"]);
  });

  it("returns non-retired agents unchanged", () => {
    const list = [agent("a"), agent("b")];
    expect(pickableAgents(list, "a")).toEqual(list);
  });
});
