import { describe, expect, it } from "vitest";
import {
  emptyWalk,
  foldWalk,
  pulseLabel,
  rowPhase,
  rowsForState,
  statePulses,
  walkSignal,
  type WalkRunRow,
} from "./runs";

const WALK = "r_walk";
const row = (o: Partial<WalkRunRow> & { runId: string }): WalkRunRow => ({
  agentId: `a_${o.runId}`,
  agent: "x",
  status: "running",
  ts: "2026-10-01T10:00:00Z",
  ...o,
});

describe("foldWalk", () => {
  it("separates the walk's own run from its members", () => {
    const v = foldWalk(emptyWalk(WALK), [row({ runId: WALK }), row({ runId: "m1", state: "plan" })]);
    expect(v.walk?.runId).toBe(WALK);
    expect([...v.members.keys()]).toEqual(["m1"]);
  });

  it("never lets an OLDER row roll a run back — the stream can beat the listing", () => {
    const done = row({ runId: "m1", state: "plan", status: "completed", ts: "2026-10-01T10:05:00Z" });
    const stale = row({ runId: "m1", state: "plan", status: "running", ts: "2026-10-01T10:01:00Z" });
    expect(foldWalk(foldWalk(emptyWalk(WALK), [done]), [stale]).members.get("m1")!.status).toBe("completed");
  });

  it("never brings a terminal run back to running, even at the same instant", () => {
    const done = row({ runId: "m1", status: "completed" });
    const again = row({ runId: "m1", status: "running" });
    expect(foldWalk(foldWalk(emptyWalk(WALK), [done]), [again]).members.get("m1")!.status).toBe("completed");
  });

  it("CLEARS a hold when the newer frame no longer reports it", () => {
    // Regression: a merge of "defined fields only" kept awaited=review after
    // the hold cleared, because a cleared hold is reported by absence.
    const held = row({ runId: "m1", state: "s", awaited: "review", ts: "2026-10-01T10:01:00Z" });
    const moving = row({ runId: "m1", ts: "2026-10-01T10:02:00Z" });
    const v = foldWalk(foldWalk(emptyWalk(WALK), [held]), [moving]);
    expect(v.members.get("m1")!.awaited).toBeUndefined();
  });

  it("keeps a run's place in the graph when a frame omits it", () => {
    const listed = row({ runId: "m1", state: "review", stateVisit: 2, waveId: "w", waveIndex: 3, ts: "2026-10-01T10:01:00Z" });
    const frame = row({ runId: "m1", status: "completed", ts: "2026-10-01T10:02:00Z" });
    const r = foldWalk(foldWalk(emptyWalk(WALK), [listed]), [frame]).members.get("m1")!;
    expect(r).toMatchObject({ status: "completed", state: "review", stateVisit: 2, waveId: "w", waveIndex: 3 });
  });

  it("returns the SAME view when nothing changed, so React does not re-render", () => {
    const v = foldWalk(emptyWalk(WALK), [row({ runId: "m1", status: "completed" })]);
    expect(foldWalk(v, [row({ runId: "m1", status: "running", ts: "2026-10-01T09:00:00Z" })])).toBe(v);
  });
});

describe("rowPhase / statePulses / pulseLabel", () => {
  it("calls a run held for review HELD, and other waits WAITING", () => {
    expect(rowPhase(row({ runId: "a", awaited: "review" }))).toBe("held");
    expect(rowPhase(row({ runId: "a", awaited: "channel" }))).toBe("waiting");
    expect(rowPhase(row({ runId: "a", status: "rejected" }))).toBe("rejected");
  });

  it("counts each state's runs, and words them for the node face", () => {
    const v = foldWalk(emptyWalk(WALK), [
      row({ runId: "1", state: "wave", status: "completed" }),
      row({ runId: "2", state: "wave", awaited: "review" }),
      row({ runId: "3", state: "wave" }),
      row({ runId: "4", state: "wave", status: "rejected" }),
      row({ runId: "5", state: "other", status: "failed" }),
    ]);
    const p = statePulses(v);
    expect(pulseLabel(p.get("wave"))).toBe("1/4 done · 1 held · 1 running · 1 rejected");
    expect(pulseLabel(p.get("other"))).toBe("0/1 done · 1 failed");
    expect(pulseLabel(p.get("unstarted"))).toBe("");
  });
});

describe("rowsForState", () => {
  it("orders a state's runs by visit, then wave position", () => {
    const v = foldWalk(emptyWalk(WALK), [
      row({ runId: "b", state: "s", stateVisit: 2, waveIndex: 0 }),
      row({ runId: "c", state: "s", stateVisit: 1, waveIndex: 1 }),
      row({ runId: "a", state: "s", stateVisit: 1, waveIndex: 0 }),
      row({ runId: "z", state: "elsewhere" }),
    ]);
    expect(rowsForState(v, "s").map((r) => r.runId)).toEqual(["a", "c", "b"]);
  });
});

describe("walkSignal — what the walk's OWN run means for the session", () => {
  const live = row({ runId: WALK });
  it("ends the session when the walk run is terminal, naming how", () => {
    expect(walkSignal(live, row({ runId: WALK, status: "completed" }))).toEqual({ t: "ended", status: "completed" });
    expect(walkSignal(live, row({ runId: WALK, status: "cancelled", stopReason: "aborted" }))).toMatchObject({
      t: "ended",
      status: "aborted",
    });
    expect(walkSignal(live, row({ runId: WALK, status: "failed", error: "boom" }))).toEqual({
      t: "ended",
      status: "failed",
      detail: "boom",
    });
  });

  it("parks the session while the walk waits on an Interruption, and releases it after", () => {
    const parked = row({ runId: WALK, awaited: "interrupted" });
    expect(walkSignal(live, parked)).toEqual({ t: "parked" });
    expect(walkSignal(parked, row({ runId: WALK }))).toEqual({ t: "released" });
  });

  it("says nothing when nothing about the walk changed", () => {
    expect(walkSignal(live, live)).toBeNull();
    expect(walkSignal(live, row({ runId: WALK, ts: "2026-10-01T11:00:00Z" }))).toBeNull();
  });
});
