// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Message from "./Message";
import { ReadAloudContext, type ReadAloud } from "../hooks/useReadAloud";
import type { SpeechPlayerState } from "../lib/speechPlayer";
import type { AssistantMessage } from "../lib/eventReducer";

// The speaker on a reply, through Message, against a stub read-aloud.

const reply: AssistantMessage = {
  role: "assistant",
  status: "done",
  parts: [
    { type: "thinking", text: "hmm", durationMs: 10 },
    { type: "text", text: "First." },
    { type: "text", text: "Second." },
  ],
};

function stub(state: Partial<SpeechPlayerState> = {}): ReadAloud {
  return {
    state: { key: null, status: "idle", error: null, unavailable: false, ...state },
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    prime: vi.fn(),
  };
}

function show(speech: ReadAloud | null, speechKey = "3") {
  return render(
    <section className="loomchat">
      <ReadAloudContext.Provider value={speech}>
        <Message message={reply} speechKey={speechKey} />
      </ReadAloudContext.Provider>
    </section>,
  );
}

afterEach(cleanup);

describe("SpeakButton", () => {
  it("shows no speaker when read-aloud is not offered", () => {
    show(null);
    expect(screen.queryByLabelText("Read aloud")).toBeNull();
    expect(screen.getByLabelText("Copy message")).toBeTruthy();
  });

  it("reads the reply's answer text, not its thinking, on click", () => {
    const speech = stub();
    show(speech);
    fireEvent.click(screen.getByLabelText("Read aloud"));
    expect(speech.play).toHaveBeenCalledWith("3", "First.\n\nSecond.");
  });

  it("shows pause, stop and the AI-voice label while its reply plays, and keeps the actions visible", () => {
    const speech = stub({ key: "3", status: "playing" });
    const { container } = show(speech);
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(speech.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Stop reading"));
    expect(speech.stop).toHaveBeenCalled();
    expect(screen.getByText("AI voice")).toBeTruthy();
    expect(container.querySelector(".msg-actions.active")).not.toBeNull();
  });

  it("offers resume when paused", () => {
    const speech = stub({ key: "3", status: "paused" });
    show(speech);
    fireEvent.click(screen.getByLabelText("Resume"));
    expect(speech.resume).toHaveBeenCalled();
  });

  it("leaves other replies as they are while one reads", () => {
    show(stub({ key: "7", status: "playing" }));
    expect(screen.getByLabelText("Read aloud")).toBeTruthy();
    expect(screen.queryByText("AI voice")).toBeNull();
  });

  it("tells a failure on the reply it happened to, and reads again on click", () => {
    const speech = stub({ error: { key: "3", message: "the speech engine failed; try again later" } });
    show(speech);
    expect(screen.getByRole("status").textContent).toBe("the speech engine failed; try again later");
    fireEvent.click(screen.getByLabelText("Read aloud"));
    expect(speech.play).toHaveBeenCalledWith("3", "First.\n\nSecond.");
  });

  it("hides the speaker once read-aloud is unavailable, keeping the reason where it happened", () => {
    const state = { unavailable: true, error: { key: "3", message: "Access denied" } };
    show(stub(state), "3");
    expect(screen.queryByLabelText("Read aloud")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Access denied");
    cleanup();
    show(stub(state), "4");
    expect(screen.queryByLabelText("Read aloud")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
