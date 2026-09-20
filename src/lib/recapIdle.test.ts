import { describe, it, expect } from "vitest";
import { nextIdleStamp, NO_IDLE, type IdleStamp } from "./recapIdle";

describe("nextIdleStamp", () => {
  it("stamps the moment a quiet chat becomes active", () => {
    expect(nextIdleStamp(NO_IDLE, "s1", false, 1000)).toEqual({
      sessionId: "s1",
      at: 1000,
    });
  });

  it("clears the stamp while the agent is working", () => {
    const quiet: IdleStamp = { sessionId: "s1", at: 1000 };
    expect(nextIdleStamp(quiet, "s1", true, 2000)).toEqual({
      sessionId: "s1",
      at: 0,
    });
  });

  // THE REGRESSION. The whole conversation lives in one steered run, so the
  // server's last_activity never moves — every turn has to produce a NEW stamp
  // from the client's own working→quiet transition, or the idle timer arms once
  // and the recap never refreshes again.
  it("produces a fresh stamp for every turn, though the server clock never moves", () => {
    let s = NO_IDLE;
    s = nextIdleStamp(s, "s1", false, 1000); // opened, quiet
    const firstQuiet = s.at;

    s = nextIdleStamp(s, "s1", true, 1500); // turn 1 starts
    s = nextIdleStamp(s, "s1", false, 2000); // turn 1 ends
    const afterTurn1 = s.at;

    s = nextIdleStamp(s, "s1", true, 2500); // turn 2 starts
    s = nextIdleStamp(s, "s1", false, 3000); // turn 2 ends
    const afterTurn2 = s.at;

    expect(firstQuiet).toBe(1000);
    expect(afterTurn1).toBe(2000);
    expect(afterTurn2).toBe(3000);
    expect(afterTurn1).toBeGreaterThan(firstQuiet);
    expect(afterTurn2).toBeGreaterThan(afterTurn1);
  });

  it("holds the stamp across unrelated re-renders so the countdown isn't restarted", () => {
    const quiet: IdleStamp = { sessionId: "s1", at: 1000 };
    // The 60s history poll re-renders with the same session, still quiet.
    const a = nextIdleStamp(quiet, "s1", false, 5000);
    const b = nextIdleStamp(a, "s1", false, 9000);
    expect(a).toBe(quiet); // identity, so React bails out of the update
    expect(b).toBe(quiet);
    expect(b.at).toBe(1000);
  });

  it("re-stamps when the user switches to another chat", () => {
    const quiet: IdleStamp = { sessionId: "s1", at: 1000 };
    expect(nextIdleStamp(quiet, "s2", false, 4000)).toEqual({
      sessionId: "s2",
      at: 4000,
    });
  });

  it("clears to NO_IDLE when there is no active sent chat", () => {
    const quiet: IdleStamp = { sessionId: "s1", at: 1000 };
    expect(nextIdleStamp(quiet, undefined, false, 4000)).toEqual(NO_IDLE);
  });

  it("holds identity when already cleared, so a draft can't loop re-renders", () => {
    expect(nextIdleStamp(NO_IDLE, undefined, false, 4000)).toBe(NO_IDLE);
  });

  it("keeps the working stamp stable across re-renders mid-turn", () => {
    const working: IdleStamp = { sessionId: "s1", at: 0 };
    expect(nextIdleStamp(working, "s1", true, 7000)).toBe(working);
  });
});
