// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Composer, { type ComposerHandle } from "./Composer";
import type { VoiceInput } from "../hooks/useVoiceInput";
import type { VoiceRecorderState } from "../lib/voiceRecorder";

// The mic as the composer shows it, against a stub voice input.

function stub(state: Partial<VoiceRecorderState> = {}, over: Partial<VoiceInput> = {}): VoiceInput {
  return {
    state: { status: "idle", startedAt: null, error: null, canRetry: false, ...state },
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
    stream: () => null,
    limitSeconds: 300,
    languages: ["uk", "en"],
    language: "uk",
    pickLanguage: vi.fn(),
    unavailable: null,
    ...over,
  };
}

function show(voice: VoiceInput | null, onSend = vi.fn()) {
  const ref = createRef<ComposerHandle>();
  const utils = render(
    <section className="loomchat">
      <Composer ref={ref} voice={voice} disabled={false} running={false} freeTokens={null} history={[]} onSend={onSend} onStop={vi.fn()} />
    </section>,
  );
  return { ...utils, ref, onSend };
}

afterEach(cleanup);

describe("MicButton", () => {
  it("shows no mic where voice input is not offered", () => {
    show(null);
    expect(screen.queryByLabelText("Voice input")).toBeNull();
  });

  it("starts recording on click", () => {
    const voice = stub();
    show(voice);
    fireEvent.click(screen.getByLabelText("Voice input"));
    expect(voice.start).toHaveBeenCalled();
  });

  it("shows the timer and a discard while recording, and stops on the mic", () => {
    const voice = stub({ status: "recording", startedAt: Date.now() - 12_000 });
    show(voice);
    expect(screen.getByRole("status").textContent).toContain("0:12");
    fireEvent.click(screen.getByLabelText("Stop and transcribe"));
    expect(voice.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Discard recording"));
    expect(voice.cancel).toHaveBeenCalled();
  });

  it("counts down in the last 15 seconds", () => {
    show(stub({ status: "recording", startedAt: Date.now() - 290_000 }));
    expect(screen.getByRole("status").textContent).toContain("stops in 10 s");
  });

  it("discards on Esc without the chat's own Escape seeing it", () => {
    const voice = stub({ status: "recording", startedAt: Date.now() });
    const chatEscape = vi.fn();
    window.addEventListener("keydown", chatEscape);
    show(voice);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", chatEscape);
    expect(voice.cancel).toHaveBeenCalled();
    expect(chatEscape).not.toHaveBeenCalled();
  });

  it("shows Transcribing… with a cancel", () => {
    const voice = stub({ status: "transcribing" });
    show(voice);
    expect(screen.getByRole("status").textContent).toContain("Transcribing…");
    fireEvent.click(screen.getAllByLabelText("Cancel voice input")[0]);
    expect(voice.cancel).toHaveBeenCalled();
  });

  it("offers retry after a failed transcription", () => {
    const voice = stub({ status: "error", error: "the speech engine failed; try again later", canRetry: true });
    show(voice);
    expect(screen.getByRole("alert").textContent).toContain("the speech engine failed");
    fireEvent.click(screen.getByLabelText("Retry"));
    expect(voice.retry).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(voice.dismiss).toHaveBeenCalled();
  });

  it("disables the mic and says why where the page cannot record", () => {
    show(stub({}, { unavailable: "Voice input needs HTTPS (or localhost)." }));
    const mic = screen.getByLabelText("Voice input needs HTTPS (or localhost).") as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
  });

  it("lets the user pick the language when there is a choice", () => {
    const voice = stub();
    show(voice);
    fireEvent.change(screen.getByLabelText("Voice input language"), { target: { value: "en" } });
    expect(voice.pickLanguage).toHaveBeenCalledWith("en");
  });

  it("inserts the transcript at the caret and does not send", () => {
    const { ref, onSend } = show(stub());
    const ta = document.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "Hello world" } });
    ta.selectionStart = ta.selectionEnd = 5;
    act(() => ref.current!.insert("big"));
    expect(ta.value).toBe("Hello big world");
    expect(onSend).not.toHaveBeenCalled();
  });
});
