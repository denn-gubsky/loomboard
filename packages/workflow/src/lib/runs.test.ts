import { describe, expect, it } from "vitest";
import {
  emptyWalk,
  foldWalk,
  liveRunByState,
  pulseLabel,
  rowPhase,
  lastState,
  rowsForState,
  statePulses,
  visitNumbers,
  waitingNote,
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

// The listing writes the server's local offset with microseconds, the stream
// UTC whole seconds. Regression: compared as strings, a listing row from a
// server east of UTC always looked newer and rolled every streamed
// transition back.
describe("foldWalk — instants in the listing's and the stream's formats", () => {
  const fold = (...rows: WalkRunRow[]) => rows.reduce((v, r) => foldWalk(v, [r]), emptyWalk(WALK)).members.get("m1")!;
  // 09:37:14.827Z, spelled the way the listing spells it on a UTC+3 server.
  const listed = row({ runId: "m1", state: "s", ts: "2026-10-01T12:37:14.827396+03:00" });
  // 34 seconds LATER in absolute time, though lexically "09" < "12".
  const held = row({ runId: "m1", awaited: "review", ts: "2026-10-01T09:37:48Z" });

  it("keeps a LATER stream row over an earlier listing row east of UTC, in either order", () => {
    expect(fold(held, listed).awaited).toBe("review");
    expect(fold(listed, held).awaited).toBe("review");
  });

  it("keeps a LATER listing row over an earlier stream row, in either order", () => {
    // West of UTC the string order inverts: "05" < "09", yet 05:37:50.5-04:00 is 09:37:50.5Z.
    const relisted = row({ runId: "m1", ts: "2026-10-01T05:37:50.5-04:00" });
    expect(fold(held, relisted).awaited).toBeUndefined();
    expect(fold(relisted, held).awaited).toBeUndefined();
  });

  it("takes the newcomer at an equal instant spelled two ways", () => {
    const sameListed = row({ runId: "m1", status: "running", ts: "2026-10-01T12:37:48.000000+03:00" });
    expect(fold(held, sameListed).awaited).toBeUndefined();
    expect(fold(sameListed, held).awaited).toBe("review");
  });

  it("takes the newcomer within one millisecond — microseconds are not compared", () => {
    const a = row({ runId: "m1", awaited: "input", ts: "2026-10-01T12:37:14.827900+03:00" });
    expect(fold(a, listed).awaited).toBeUndefined();
  });

  it("treats an unparseable instant as the oldest", () => {
    const garbled = row({ runId: "m1", ts: "not a time" });
    expect(fold(held, garbled).awaited).toBe("review");
    expect(fold(garbled, held).awaited).toBe("review");
    // Two unparseable instants tie, and a tie takes the newcomer.
    expect(fold(garbled, row({ runId: "m1", awaited: "input", ts: "" })).awaited).toBe("input");
  });

  it("still never brings a terminal run back, however newer the other row", () => {
    const done = row({ runId: "m1", status: "completed", ts: "2026-10-01T09:37:48Z" });
    expect(fold(done, row({ runId: "m1", ts: "2026-10-01T12:40:00.000001+03:00" })).status).toBe("completed");
  });
});

describe("foldWalk — a review hold's deadline", () => {
  const fold = (...rows: WalkRunRow[]) => rows.reduce((v, r) => foldWalk(v, [r]), emptyWalk(WALK)).members.get("m1")!;
  const DEADLINE = "2026-10-01T10:37:48Z";
  // Only the stream carries hold_expires_at.
  const frame = row({ runId: "m1", awaited: "review", holdExpiresAt: DEADLINE, ts: "2026-10-01T09:37:48Z" });

  it("keeps the deadline when a newer listing row of the same hold omits it", () => {
    const heartbeat = row({ runId: "m1", awaited: "review", ts: "2026-10-01T12:38:00.1+03:00" });
    expect(fold(frame, heartbeat).holdExpiresAt).toBe(DEADLINE);
  });

  it("drops the deadline once the hold clears", () => {
    const released = row({ runId: "m1", ts: "2026-10-01T12:38:00.1+03:00" });
    expect(fold(frame, released).holdExpiresAt).toBeUndefined();
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

describe("waitingNote — what a waiting run is waiting on", () => {
  it("names the background sub-agents a run waits for, by run id", () => {
    expect(waitingNote(row({ runId: "p", awaited: "children", awaitedOn: "r_a1" }))).toBe("waiting for 1 background sub-agent to finish: r_a1");
    expect(waitingNote(row({ runId: "p", awaited: "children", awaitedOn: "r_a1, r_b2,r_c3" }))).toBe(
      "waiting for 3 background sub-agents to finish: r_a1, r_b2, r_c3",
    );
  });

  it("lists the first three sub-agents and counts the rest", () => {
    expect(waitingNote(row({ runId: "p", awaited: "children", awaitedOn: "r_1,r_2,r_3,r_4,r_5" }))).toBe(
      "waiting for 5 background sub-agents to finish: r_1, r_2, r_3, and 2 more",
    );
  });

  it("still says it waits on sub-agents when the runtime names none", () => {
    expect(waitingNote(row({ runId: "p", awaited: "children" }))).toBe("waiting for its background sub-agents to finish");
  });

  it("says what else a run can wait on: a channel, an answer, the operator's next message", () => {
    expect(waitingNote(row({ runId: "p", awaited: "channel", awaitedOn: "sdlc-intake" }))).toBe("waiting for a message on channel sdlc-intake");
    expect(waitingNote(row({ runId: "p", awaited: "interrupted", awaitedOn: "question" }))).toBe("waiting for an answer to its question (question)");
    expect(waitingNote(row({ runId: "p", awaited: "input" }))).toBe("waiting for the operator's next message");
  });

  it("says nothing for a run that is not waiting — running, held for review, or ended", () => {
    expect(waitingNote(row({ runId: "p" }))).toBeUndefined();
    expect(waitingNote(row({ runId: "p", awaited: "review", awaitedOn: "gate" }))).toBeUndefined();
    // A stale awaited on a run that has ended must not read as waiting.
    expect(waitingNote(row({ runId: "p", status: "completed", awaited: "children", awaitedOn: "r_a1" }))).toBeUndefined();
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

describe("visitNumbers", () => {
  it("numbers a state's OWN visits — state_visit is the walk's ordinal, not the state's", () => {
    // Live: research ran as walk visit 1, edit as walk visit 2 — edit's FIRST
    // and only visit, which a raw "visit 2" label misread as a revisit.
    expect(visitNumbers([row({ runId: "e", state: "edit", stateVisit: 2 })])).toEqual(new Map([["e", 1]]));
    const n = visitNumbers([
      row({ runId: "a", state: "s", stateVisit: 3, waveIndex: 0 }),
      row({ runId: "b", state: "s", stateVisit: 3, waveIndex: 1 }),
      row({ runId: "c", state: "s", stateVisit: 7 }),
    ]);
    expect([...n]).toEqual([["a", 1], ["b", 1], ["c", 2]]);
  });

  it("leaves a row without a visit unnumbered", () => {
    expect(visitNumbers([row({ runId: "x", state: "s" })]).has("x")).toBe(false);
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

describe("lastState — the state the walk ran last, by instant", () => {
  it("orders by TIME, not by spelling — a +03:00 listing row is not newer than a later UTC frame", () => {
    // As strings "…12:37:14.827396+03:00" sorts after "…09:40:00Z", but it
    // is 09:37:14Z — before the edit row.
    const v = foldWalk(emptyWalk(WALK), [
      row({ runId: "r", state: "research", status: "completed", ts: "2026-10-01T12:37:14.827396+03:00" }),
      row({ runId: "e", state: "edit", status: "completed", ts: "2026-10-01T09:40:00Z" }),
    ]);
    expect(lastState(v)).toBe("edit");
  });

  it("is undefined before any member ran", () => {
    expect(lastState(emptyWalk(WALK))).toBeUndefined();
  });

  it("breaks a visit and wave tie in rowsForState by instant too", () => {
    const v = foldWalk(emptyWalk(WALK), [
      // 09:40Z is LATER than 12:36+03:00 (09:36Z), but sorts first as a string.
      row({ runId: "late", state: "s", ts: "2026-10-01T09:40:00Z" }),
      row({ runId: "early", state: "s", ts: "2026-10-01T12:36:00+03:00" }),
    ]);
    expect(rowsForState(v, "s").map((r) => r.runId)).toEqual(["early", "late"]);
  });
});

describe("liveRunByState — the run Run mode follows on each node", () => {
  it("is each state's most recent run still going — none for a state whose runs all settled", () => {
    const v = foldWalk(emptyWalk(WALK), [
      row({ runId: "r1", state: "research", status: "completed", ts: "2026-10-01T10:00:00Z" }),
      row({ runId: "w1", state: "write", status: "running", ts: "2026-10-01T10:01:00Z" }),
      row({ runId: "w2", state: "write", status: "running", ts: "2026-10-01T10:02:00Z", awaited: "review" }),
    ]);
    const live = liveRunByState(v);
    expect([...live.keys()]).toEqual(["write"]);
    expect(live.get("write")!.runId).toBe("w2");
  });
});
