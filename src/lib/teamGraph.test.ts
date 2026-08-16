import { describe, it, expect } from "vitest";
import {
  parseTeamGraph,
  allowedTargets,
  canTransition,
  handlerAgents,
} from "./teamGraph";

// A realistic (sdlc-shaped) TeamDef definition, plus the pushback edge.
const SDLC = {
  entry: "architect",
  states: [
    { state: "architect", handler: { kind: "agent", agent: "architect-v1" } },
    { state: "plan", handler: { kind: "agent", agent: "planner-v1" } },
    { state: "implement", handler: { kind: "agent", agent: "coder-v1" } },
    {
      state: "review",
      handler: { kind: "parallel", agents: ["sec-reviewer-v1", "perf-reviewer-v1"] },
    },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "architect", to: "plan", on: "success" },
    { from: "plan", to: "implement", on: "success" },
    { from: "plan", to: "architect", on: "pushback:underspecified" },
    { from: "implement", to: "review", on: "success" },
    { from: "review", to: "done", on: "success" },
    { from: "review", to: "implement", on: "pushback:changes" },
  ],
  colors: { states: { done: "#0a0" } },
};

describe("parseTeamGraph", () => {
  it("reads states in order as the kanban columns", () => {
    const g = parseTeamGraph(SDLC);
    expect(g.entry).toBe("architect");
    expect(g.states).toEqual(["architect", "plan", "implement", "review", "done"]);
    expect(g.transitions).toHaveLength(6);
  });
  it("degrades gracefully on garbage / partial input", () => {
    expect(parseTeamGraph(null).states).toEqual([]);
    expect(parseTeamGraph("nope").transitions).toEqual([]);
    const partial = parseTeamGraph({ states: [{ state: "a" }, { nope: 1 }, { state: "a" }] });
    expect(partial.states).toEqual(["a"]); // dedupes + skips the malformed entry
    expect(partial.handlers.a.kind).toBe("agent"); // missing handler → default
  });
});

describe("allowedTargets / canTransition", () => {
  const g = parseTeamGraph(SDLC);
  it("lists one-step targets incl. pushback edges", () => {
    expect(allowedTargets(g, "plan").sort()).toEqual(["architect", "implement"]);
    expect(allowedTargets(g, "done")).toEqual([]); // terminal
  });
  it("validates a drag-drop move against the transitions", () => {
    expect(canTransition(g, "plan", "implement")).toBe(true);
    expect(canTransition(g, "plan", "done")).toBe(false); // not a declared edge
    expect(canTransition(g, "review", "implement")).toBe(true); // pushback allowed
    expect(canTransition(g, "plan", "plan")).toBe(false); // no self-move
  });
});

describe("handlerAgents", () => {
  const g = parseTeamGraph(SDLC);
  it("returns the single agent, the parallel fan-out, or none", () => {
    expect(handlerAgents(g, "architect")).toEqual(["architect-v1"]);
    expect(handlerAgents(g, "review")).toEqual(["sec-reviewer-v1", "perf-reviewer-v1"]);
    expect(handlerAgents(g, "done")).toEqual([]); // terminal has no agent
    expect(handlerAgents(g, "missing")).toEqual([]);
  });
});
