import { describe, it, expect } from "vitest";
import { navigateHistory, noHistoryNav, type HistoryState } from "./inputHistory";

// history is oldest-first; "c" is the most recent send.
const HIST = ["a", "b", "c"];

// Convenience: apply a sequence of directions from a starting state, threading
// the value back in as the current text (mimics the composer).
function walk(
  history: string[],
  dirs: ("up" | "down")[],
  start: { state: HistoryState; value: string },
) {
  return dirs.reduce(
    (acc, dir) => navigateHistory(history, acc.state, dir, acc.value),
    start,
  );
}

describe("navigateHistory", () => {
  it("is a no-op when there is no history", () => {
    const r = navigateHistory([], noHistoryNav, "up", "draft");
    expect(r.value).toBe("draft");
    expect(r.state).toEqual(noHistoryNav);
  });

  it("recalls the most recent entry on the first up", () => {
    const r = navigateHistory(HIST, noHistoryNav, "up", "half typed");
    expect(r.value).toBe("c");
    expect(r.state.index).toBe(1);
  });

  it("captures the live draft so it can be restored", () => {
    const r = navigateHistory(HIST, noHistoryNav, "up", "half typed");
    expect(r.state.draft).toBe("half typed");
  });

  it("walks older with successive ups", () => {
    const r = walk(HIST, ["up", "up", "up"], { state: noHistoryNav, value: "" });
    expect(r.value).toBe("a"); // oldest
    expect(r.state.index).toBe(3);
  });

  it("clamps at the oldest entry", () => {
    const r = walk(HIST, ["up", "up", "up", "up", "up"], {
      state: noHistoryNav,
      value: "",
    });
    expect(r.value).toBe("a");
    expect(r.state.index).toBe(3);
  });

  it("steps back toward the draft with down and restores it at index 0", () => {
    const r = walk(HIST, ["up", "up", "down"], {
      state: noHistoryNav,
      value: "keep me",
    });
    expect(r.value).toBe("c"); // back to newest
    const back = navigateHistory(HIST, r.state, "down", r.value);
    expect(back.value).toBe("keep me"); // draft restored
    expect(back.state.index).toBe(0);
  });

  it("down at the draft is a no-op", () => {
    const r = navigateHistory(HIST, noHistoryNav, "down", "typing");
    expect(r.value).toBe("typing");
    expect(r.state.index).toBe(0);
  });
});
