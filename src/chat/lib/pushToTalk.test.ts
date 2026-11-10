import { describe, expect, it } from "vitest";
import { HOLD_MS, releaseAction, tapAction } from "./pushToTalk";

describe("releaseAction", () => {
  it("transcribes and sends a hold that ends over the mic", () => {
    expect(releaseAction(HOLD_MS, "recording", true)).toBe("stop");
    expect(releaseAction(4_000, "recording", true)).toBe("stop");
  });

  it("keeps a tap recording hands-free", () => {
    expect(releaseAction(HOLD_MS - 1, "recording", true)).toBe("none");
    expect(releaseAction(50, "starting", true)).toBe("none");
  });

  it("discards a take released off the mic", () => {
    expect(releaseAction(2_000, "recording", false)).toBe("cancel");
    expect(releaseAction(100, "recording", false)).toBe("cancel");
  });

  it("drops a hold that ended before the microphone was live", () => {
    expect(releaseAction(1_500, "starting", true)).toBe("cancel");
  });

  it("marks a take the limit stopped mid-hold as one to send", () => {
    expect(releaseAction(300_500, "transcribing", true)).toBe("send");
  });

  it("does nothing when the press left nothing in flight", () => {
    expect(releaseAction(2_000, "error", true)).toBe("none");
    expect(releaseAction(2_000, "idle", false)).toBe("none");
  });
});

describe("tapAction", () => {
  it("starts from rest, stops a recording, and cancels a wait", () => {
    expect(tapAction("idle")).toBe("start");
    expect(tapAction("error")).toBe("start");
    expect(tapAction("recording")).toBe("stop");
    expect(tapAction("starting")).toBe("cancel");
    expect(tapAction("transcribing")).toBe("cancel");
  });
});
