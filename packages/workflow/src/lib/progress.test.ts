import { describe, expect, it } from "vitest";
import { fromDefinition } from "./model";
import { walkProgress } from "./progress";
import type { WalkRunRow, WalkView } from "./runs";

const row = (runId: string, state: string, status: string, stateVisit: number): WalkRunRow => ({
  runId,
  agentId: runId,
  agent: "x",
  status,
  ts: `2026-10-02T10:0${stateVisit}:00Z`,
  state,
  stateVisit,
});

const walk = (rows: WalkRunRow[], walkStatus = "running"): WalkView => ({
  walkRunId: "r_walk",
  walk: { runId: "r_walk", agentId: "w", agent: "team:t", status: walkStatus, ts: "2026-10-02T10:00:00Z" },
  members: new Map(rows.map((r) => [r.runId, r])),
});

const sets = (p: ReturnType<typeof walkProgress>) =>
  p && { active: [...p.active].sort(), passed: [...p.passed].sort(), taken: [...p.taken].sort() };

// pcparts with a form: form → research (Starter) → edit (agent) → done.
const pipeline = fromDefinition({
  entry: "form",
  states: [
    { state: "form", handler: { kind: "input", publish: { channel: "in" } } },
    { state: "research", handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "r", max: 1 } } },
    { state: "edit", handler: { kind: "agent", agent: "e" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "form", to: "research", on: "success" },
    { from: "research", to: "edit", on: "success" },
    { from: "edit", to: "done", on: "success" },
  ],
});

// A review loop: code → review, review → code on pushback, review → done.
const loop = fromDefinition({
  entry: "code",
  states: [
    { state: "code", handler: { kind: "agent", agent: "c" } },
    { state: "review", handler: { kind: "agent", agent: "r" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "code", to: "review", on: "success" },
    { from: "review", to: "code", on: "pushback:redo" },
    { from: "review", to: "done", on: "success" },
  ],
});

describe("walkProgress", () => {
  it("marks the running state active and the Input it came through passed, by the transition it took", () => {
    expect(sets(walkProgress(pipeline, walk([row("m1", "research", "running", 1)])))).toEqual({
      active: ["research"],
      passed: ["form"],
      taken: ["form success research"],
    });
  });

  it("moves on: the settled state is passed, the next one active, and the step between them taken", () => {
    const p = walkProgress(pipeline, walk([row("m1", "research", "completed", 1), row("m2", "edit", "running", 2)]));
    expect(sets(p)).toEqual({
      active: ["edit"],
      passed: ["form", "research"],
      taken: ["form success research", "research success edit"],
    });
  });

  it("counts a held or waiting run as still going", () => {
    const held = { ...row("m1", "research", "running", 1), awaited: "review" as const };
    expect([...walkProgress(pipeline, walk([held]))!.active]).toEqual(["research"]);
  });

  it("in a gap where nothing runs, shows where the walk is heading — never an End", () => {
    // Before the Starter has dispatched: past the Input, into research.
    expect(sets(walkProgress(pipeline, walk([])))?.active).toEqual(["research"]);
    // research settled, edit not started yet.
    expect(sets(walkProgress(pipeline, walk([row("m1", "research", "completed", 1)])))?.active).toEqual(["edit"]);
    // edit settled: next is the End, which is not a state the walk works in.
    const last = walk([row("m1", "research", "completed", 1), row("m2", "edit", "completed", 2)]);
    expect(sets(walkProgress(pipeline, last))?.active).toEqual([]);
  });

  it("leaves a pushback edge uncoloured until the walk actually goes back", () => {
    const p = walkProgress(loop, walk([row("m1", "code", "completed", 1), row("m2", "review", "running", 2)]));
    expect(sets(p)?.taken).toEqual(["code success review"]);
  });

  it("after a pushback: the re-entered state is active again, and BOTH steps of the loop are taken", () => {
    const p = walkProgress(
      loop,
      walk([row("m1", "code", "completed", 1), row("m2", "review", "completed", 2), row("m3", "code", "running", 3)]),
    );
    expect(sets(p)).toEqual({
      active: ["code"],
      passed: ["review"],
      taken: ["code success review", "review pushback:redo code"],
    });
  });

  it("resets when the walk ends — no colours on a finished run", () => {
    expect(walkProgress(pipeline, walk([row("m1", "research", "completed", 1)], "completed"))).toBeUndefined();
    expect(walkProgress(pipeline, walk([], "failed"))).toBeUndefined();
    expect(walkProgress(pipeline, undefined)).toBeUndefined();
  });
});
