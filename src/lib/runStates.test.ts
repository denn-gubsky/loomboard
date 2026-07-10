import { describe, it, expect } from "vitest";
import type { Agent, RunStateEvent } from "@loomcycle/client";
import {
  applyRunStateEvent,
  normalizeStatus,
  tileDisplayState,
  tileFromAgent,
  type RunTile,
} from "./runStates";

function ev(patch: Partial<RunStateEvent>): RunStateEvent {
  return {
    run_id: "r1",
    agent_id: "a1",
    agent: "researcher",
    user_id: "u1",
    status: "running",
    ts: "2026-07-10T00:00:00Z",
    ...patch,
  } as RunStateEvent;
}

describe("normalizeStatus", () => {
  it("passes through terminal states and treats anything else as running", () => {
    expect(normalizeStatus("completed")).toBe("completed");
    expect(normalizeStatus("failed")).toBe("failed");
    expect(normalizeStatus("cancelled")).toBe("cancelled");
    expect(normalizeStatus("running")).toBe("running");
    expect(normalizeStatus("awaiting_input")).toBe("running"); // unmodeled → running
    expect(normalizeStatus("")).toBe("running");
  });
});

describe("applyRunStateEvent", () => {
  it("inserts a new tile from a transition frame", () => {
    const tiles = applyRunStateEvent(new Map(), ev({}));
    expect(tiles.get("r1")).toMatchObject({
      runId: "r1",
      agent: "researcher",
      status: "running",
      ts: "2026-07-10T00:00:00Z",
    });
  });

  it("updates status + ts + error on a later transition and is immutable", () => {
    const t0 = applyRunStateEvent(new Map(), ev({}));
    const t1 = applyRunStateEvent(
      t0,
      ev({ status: "failed", error: "boom", ts: "2026-07-10T00:01:00Z" }),
    );
    expect(t0.get("r1")?.status).toBe("running"); // original untouched
    expect(t1).not.toBe(t0);
    expect(t1.get("r1")).toMatchObject({ status: "failed", error: "boom", ts: "2026-07-10T00:01:00Z" });
  });

  it("preserves the hydrated sessionId across transition frames (which omit it)", () => {
    const seed = new Map<string, RunTile>([
      ["r1", { runId: "r1", agentId: "a1", agent: "researcher", status: "running", ts: "t0", sessionId: "s1" }],
    ]);
    const next = applyRunStateEvent(seed, ev({ status: "completed" }));
    expect(next.get("r1")?.sessionId).toBe("s1");
    expect(next.get("r1")?.status).toBe("completed");
  });
});

describe("tileFromAgent", () => {
  it("hydrates a tile including sessionId from a snapshot", () => {
    const agent = {
      agent_id: "a1",
      run_id: "r1",
      session_id: "s1",
      agent: "planner",
      parent_agent_id: null,
      user_id: "u1",
      status: "running",
      started_at: "2026-07-10T00:00:00Z",
      completed_at: null,
      stop_reason: null,
      error: null,
      usage: {},
      last_heartbeat_at: "2026-07-10T00:00:30Z",
    } as unknown as Agent;
    expect(tileFromAgent(agent)).toMatchObject({
      runId: "r1",
      agent: "planner",
      status: "running",
      sessionId: "s1",
      ts: "2026-07-10T00:00:30Z", // last_heartbeat_at preferred over started_at while live
    });
  });
});

describe("tileDisplayState", () => {
  const base: RunTile = { runId: "r1", agentId: "a1", agent: "x", status: "running", ts: "t" };
  it("running with a pending question → needs_input", () => {
    expect(tileDisplayState(base, true)).toBe("needs_input");
  });
  it("running without a question → running", () => {
    expect(tileDisplayState(base, false)).toBe("running");
  });
  it("maps completed → done, and passes failed/cancelled through", () => {
    expect(tileDisplayState({ ...base, status: "completed" }, false)).toBe("done");
    expect(tileDisplayState({ ...base, status: "failed" }, false)).toBe("failed");
    expect(tileDisplayState({ ...base, status: "cancelled" }, false)).toBe("cancelled");
  });
});
