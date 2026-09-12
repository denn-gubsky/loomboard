import { describe, expect, it } from "vitest";
import {
  INITIAL,
  abortAvailability,
  canEditGraph,
  canReturnToEdit,
  canStart,
  isLive,
  reduce,
  statusLabel,
  type SessionEvent,
  type SessionState,
} from "./session";

/** Fold a sequence, so a test reads as the operator's actual path. */
const run = (...events: SessionEvent[]): SessionState => events.reduce(reduce, INITIAL);

const started = (debug = false) => run({ t: "start", runId: "r_1", debug });

describe("the session machine — starting a walk", () => {
  it("starts in Edit with nothing live", () => {
    expect(INITIAL.mode).toBe("edit");
    expect(isLive(INITIAL)).toBe(false);
    expect(canEditGraph(INITIAL)).toBe(true);
    expect(canReturnToEdit(INITIAL)).toBe(false);
  });

  it("keeps the run id — it is the handle every live surface addresses", () => {
    expect(started().runId).toBe("r_1");
  });

  it("enters Debug directly when started with breakpoints", () => {
    expect(started(true).mode).toBe("debug");
    expect(started(false).mode).toBe("run");
  });

  it("ignores a second start while a walk is live", () => {
    // A double-click must not orphan the first run id.
    const s = reduce(started(), { t: "start", runId: "r_2", debug: false });
    expect(s.runId).toBe("r_1");
    expect(canStart(s)).toBe(false);
  });
});

describe("the session machine — the read-only invariant", () => {
  it("makes the graph read-only for the whole life of a walk", () => {
    // A walk executes one pinned def_id; editing under it produces a canvas
    // that no longer describes what is running.
    const running = started();
    expect(canEditGraph(running)).toBe(false);
    expect(canEditGraph(reduce(running, { t: "parked" }))).toBe(false);
  });

  it("refuses to edit even a state that claims Edit mode while live", () => {
    // The reducer never produces this pairing — `start` always moves the mode
    // off "edit". But `canEditGraph` is exported, so a host can hand it any
    // state, and the guard has to hold on its own rather than lean on the
    // reducer's discipline. Found by mutation: dropping `!isLive` here broke
    // nothing, because no reducer path reaches it.
    const impossible: SessionState = { mode: "edit", phase: "running", runId: "r", armed: [] };
    expect(canEditGraph(impossible)).toBe(false);
  });

  it("REFUSES to return to Edit while a walk is live", () => {
    // The invariant this whole module exists for.
    for (const live of [started(), run({ t: "start", runId: "r", debug: true }, { t: "parked" })]) {
      expect(isLive(live)).toBe(true);
      expect(canReturnToEdit(live)).toBe(false);
      // And the event itself is inert, not merely un-offered.
      expect(reduce(live, { t: "toEdit" })).toBe(live);
    }
  });

  it("allows Edit again once the walk has ended, and only explicitly", () => {
    const ended = run({ t: "start", runId: "r", debug: false }, { t: "ended", status: "completed" });
    expect(canReturnToEdit(ended)).toBe(true);
    // Still in Run mode until the operator asks — the trace does not clear
    // itself the moment the run finishes.
    expect(ended.mode).toBe("run");
    expect(canEditGraph(ended)).toBe(false);

    const back = reduce(ended, { t: "toEdit" });
    expect(back.mode).toBe("edit");
    expect(back.runId).toBeUndefined();
    expect(back.ended).toBeUndefined();
  });
});

describe("the session machine — Run ⇄ Debug", () => {
  it("promotes Run to Debug when a breakpoint is armed mid-walk", () => {
    // The ad-hoc Run → Debug switch (C5/P6), arriving from the UI.
    const s = reduce(started(), { t: "armed", armed: ["wave:before_dispatch"] });
    expect(s.mode).toBe("debug");
  });

  it("demotes Debug to Run when the armed set is cleared", () => {
    const s = run(
      { t: "start", runId: "r", debug: false },
      { t: "armed", armed: ["wave"] },
      { t: "armed", armed: [] },
    );
    expect(s.mode).toBe("run");
  });

  it("stays in Debug while parked even if the set is cleared", () => {
    // Disarming is how a parked walk is RELEASED, so the step controls have to
    // still be on screen when it happens. Demoting here would hide them at the
    // exact moment they are needed.
    const s = run(
      { t: "start", runId: "r", debug: true },
      { t: "armed", armed: ["wave"] },
      { t: "parked" },
      { t: "armed", armed: [] },
    );
    expect(s.mode).toBe("debug");
    expect(s.phase).toBe("parked");
  });

  it("promotes to Debug on reaching a pause, however the run was started", () => {
    // The surface IS a debugger once something has paused, regardless of which
    // button started it.
    expect(reduce(started(false), { t: "parked" }).mode).toBe("debug");
  });

  it("keeps the armed set canonical and sorted", () => {
    const s = reduce(started(), { t: "armed", armed: ["b:after_collection", "a:before_dispatch"] });
    expect(s.armed).toEqual(["a:before_dispatch", "b:after_collection"]);
  });

  it("does not change mode by arming before anything has started", () => {
    // Arming in Edit is just staging; it must not pretend a walk is running.
    const s = reduce(INITIAL, { t: "armed", armed: ["wave"] });
    expect(s.mode).toBe("edit");
    expect(s.armed).toEqual(["wave"]);
  });
});

describe("the session machine — ending", () => {
  it("releases a parked walk back to running", () => {
    const s = run({ t: "start", runId: "r", debug: true }, { t: "parked" }, { t: "released" });
    expect(s.phase).toBe("running");
  });

  it("lands an aborted parked session in Stopped, never in Edit", () => {
    // Named in RFC CZ's verification list: abort must not silently discard the
    // trace by dropping the operator back into the editor.
    const s = run(
      { t: "start", runId: "r", debug: true },
      { t: "parked" },
      { t: "ended", status: "aborted" },
    );
    expect(s.phase).toBe("ended");
    expect(s.mode).toBe("debug");
    expect(s.ended?.status).toBe("aborted");
  });

  it("keeps the trace's mode so a failed wave is read where it happened", () => {
    const s = run({ t: "start", runId: "r", debug: true }, { t: "ended", status: "failed" });
    expect(s.mode).toBe("debug");
  });

  it("ignores an end for a walk that never started", () => {
    expect(reduce(INITIAL, { t: "ended", status: "completed" })).toBe(INITIAL);
  });

  it("ignores a release when not parked", () => {
    const running = started();
    expect(reduce(running, { t: "released" })).toBe(running);
  });
});

describe("abort availability — honest about what the runtime can do", () => {
  it("is available while parked, which is the path that actually works", () => {
    const parked = run({ t: "start", runId: "r", debug: true }, { t: "parked" });
    expect(abortAvailability(parked)).toEqual({ available: true });
  });

  it("is NOT available on a running walk, and says why", () => {
    // Verified against loomcycle f08068b7: run-cancel is cancelTurn and 409s
    // `not_interactive`; the agents route 400s because a walk's agent id is
    // `team:<name>` and validIdent rejects the colon. A button here would
    // simply error, so it is withheld with a reason instead.
    const a = abortAvailability(started());
    expect(a.available).toBe(false);
    if (!a.available) {
      expect(a.reason).toMatch(/not paused/i);
      expect(a.reason).toMatch(/breakpoint/i);
    }
  });

  it("is not available when nothing is running", () => {
    expect(abortAvailability(INITIAL).available).toBe(false);
  });
});

describe("statusLabel", () => {
  it.each([
    [INITIAL, "Editing"],
    [started(false), "Running"],
    [started(true), "Debugging"],
    [run({ t: "start", runId: "r", debug: true }, { t: "parked" }), "Paused at a breakpoint"],
    [run({ t: "start", runId: "r", debug: false }, { t: "ended", status: "completed" }), "Finished"],
    [run({ t: "start", runId: "r", debug: false }, { t: "ended", status: "aborted" }), "Run aborted"],
    [
      run({ t: "start", runId: "r", debug: false }, { t: "ended", status: "capped" }),
      "Hit the iteration cap",
    ],
  ])("describes the session", (state, label) => {
    expect(statusLabel(state as SessionState)).toBe(label);
  });
});
