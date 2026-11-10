// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Composer, { type ComposerHandle } from "./Composer";
import type { VoiceInput } from "../hooks/useVoiceInput";
import type { VoiceRecorderState } from "../lib/voiceRecorder";
import { SEND_DELAY_MS } from "../lib/pushToTalk";

// The mic as the composer shows it, against a stub voice input.

function stub(state: Partial<VoiceRecorderState> = {}, over: Partial<VoiceInput> = {}): VoiceInput {
  return {
    state: { status: "idle", startedAt: null, error: null, canRetry: false, ...state },
    start: vi.fn(),
    stop: vi.fn(),
    press: vi.fn(),
    release: vi.fn(),
    tap: vi.fn(),
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

  it("records from the press, and releases over the mic or off it", () => {
    const voice = stub();
    show(voice);
    const mic = screen.getByLabelText("Voice input");
    fireEvent.pointerDown(mic, { button: 0, pointerId: 1 });
    expect(voice.press).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(mic, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    expect(voice.release).toHaveBeenLastCalledWith(true);
    fireEvent.pointerDown(mic, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(mic, { button: 0, pointerId: 1, clientX: 400, clientY: 0 });
    expect(voice.release).toHaveBeenLastCalledWith(false);
    fireEvent.click(mic, { detail: 1 }); // the click the pointer press itself produces
    expect(voice.tap).not.toHaveBeenCalled();
  });

  it("does not record from a disabled mic, which Chrome still sends pointer events to", () => {
    const voice = stub();
    const ref = createRef<ComposerHandle>();
    render(
      <section className="loomchat">
        <Composer ref={ref} voice={voice} disabled running={false} freeTokens={null} history={[]} onSend={vi.fn()} onStop={vi.fn()} />
      </section>,
    );
    const mic = screen.getByLabelText("Voice input");
    fireEvent.pointerDown(mic, { button: 0, pointerId: 1 });
    fireEvent.keyDown(mic, { key: " " });
    expect(voice.press).not.toHaveBeenCalled();
  });

  it("ignores a press with another mouse button", () => {
    const voice = stub();
    show(voice);
    fireEvent.pointerDown(screen.getByLabelText("Voice input"), { button: 2, pointerId: 1 });
    expect(voice.press).not.toHaveBeenCalled();
  });

  it("treats a keyboard click as a tap, and Space held as a hold", () => {
    const voice = stub();
    show(voice);
    const mic = screen.getByLabelText("Voice input");
    fireEvent.click(mic, { detail: 0 });
    expect(voice.tap).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(mic, { key: " " });
    fireEvent.keyDown(mic, { key: " ", repeat: true });
    expect(voice.press).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(mic, { key: " " });
    expect(voice.release).toHaveBeenCalledWith(true);
    fireEvent.click(mic, { detail: 0 }); // the click a Space keyup may produce
    expect(voice.tap).toHaveBeenCalledTimes(1);
  });

  it("shows the timer and a discard while recording, and stops on the mic", () => {
    const voice = stub({ status: "recording", startedAt: Date.now() - 12_000 });
    show(voice);
    expect(screen.getByRole("status").textContent).toContain("0:12");
    fireEvent.click(screen.getByLabelText("Stop and transcribe"), { detail: 0 });
    expect(voice.tap).toHaveBeenCalled();
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

  it("names each language in itself", () => {
    show(stub());
    const picker = screen.getByLabelText("Voice input language") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["uk · Українська", "en · English"]);
  });

  it("hides the language switch when the server offers one language", () => {
    show(stub({}, { languages: ["uk"], language: "uk" }));
    expect(screen.getByLabelText("Voice input")).toBeTruthy();
    expect(screen.queryByLabelText("Voice input language")).toBeNull();
  });

  it("inserts a dictated transcript at the caret and does not send it", () => {
    const { ref, onSend } = show(stub());
    const ta = document.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "Hello world" } });
    ta.selectionStart = ta.selectionEnd = 5;
    act(() => ref.current!.insert("big"));
    expect(ta.value).toBe("Hello big world");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("the send window of a held take", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function held(over: { disabled?: boolean } = {}) {
    const onSend = vi.fn();
    const ref = createRef<ComposerHandle>();
    const voice = stub();
    const utils = render(
      <section className="loomchat">
        <Composer ref={ref} voice={voice} disabled={over.disabled ?? false} running={false} freeTokens={null} history={[]} historyKey="c1" onSend={onSend} onStop={vi.fn()} />
      </section>,
    );
    act(() => ref.current!.insert("Book the room", { send: true }));
    return { ...utils, ref, onSend, voice };
  }

  it("sends the draft once the window passes untouched", () => {
    const { onSend } = held();
    expect(screen.getByLabelText("Cancel send")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Sending in 3 s");
    act(() => vi.advanceTimersByTime(SEND_DELAY_MS - 1));
    expect(onSend).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSend).toHaveBeenCalledWith("Book the room", []);
    expect(screen.queryByLabelText("Cancel send")).toBeNull();
  });

  it("keeps the text as a draft on Cancel send", () => {
    const { onSend } = held();
    fireEvent.pointerDown(screen.getByLabelText("Cancel send"), { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(SEND_DELAY_MS * 2));
    expect(onSend).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")!.value).toBe("Book the room");
    expect(screen.getByLabelText("Voice input")).toBeTruthy();
  });

  it("stops when the user clicks or types in the input", () => {
    for (const touch of [
      (ta: HTMLTextAreaElement) => fireEvent.pointerDown(ta),
      (ta: HTMLTextAreaElement) => fireEvent.keyDown(ta, { key: "a" }),
      (ta: HTMLTextAreaElement) => fireEvent.change(ta, { target: { value: "Book the big room" } }),
    ]) {
      const { onSend, unmount } = held();
      touch(document.querySelector("textarea")!);
      act(() => vi.advanceTimersByTime(SEND_DELAY_MS * 2));
      expect(onSend).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("stops on Esc without the chat's own Escape seeing it", () => {
    const chatEscape = vi.fn();
    window.addEventListener("keydown", chatEscape);
    const { onSend } = held();
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", chatEscape);
    act(() => vi.advanceTimersByTime(SEND_DELAY_MS * 2));
    expect(onSend).not.toHaveBeenCalled();
    expect(chatEscape).not.toHaveBeenCalled();
  });

  it("does not start when the composer cannot send", () => {
    const { onSend } = held({ disabled: true });
    expect(screen.queryByLabelText("Cancel send")).toBeNull();
    act(() => vi.advanceTimersByTime(SEND_DELAY_MS * 2));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("never sends into the conversation switched to", () => {
    const { onSend, rerender, ref, voice } = held();
    rerender(
      <section className="loomchat">
        <Composer ref={ref} voice={voice} disabled={false} running={false} freeTokens={null} history={[]} historyKey="c2" onSend={onSend} onStop={vi.fn()} />
      </section>,
    );
    act(() => vi.advanceTimersByTime(SEND_DELAY_MS * 2));
    expect(onSend).not.toHaveBeenCalled();
  });
});
