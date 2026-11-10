// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoomcycleClient, TranscriptionDirectionInfo } from "@loomcycle/client";
import { micUnavailable, useVoiceInput } from "./useVoiceInput";

// jsdom has no microphone, MediaRecorder or AudioContext. The fakes below
// record; with no AudioContext the WAV conversion fails, so these tests also
// exercise the fallback to the recorder's own file.
let track: { stopped: boolean; stop(): void };
class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, o?: { mimeType?: string }) {
    this.mimeType = o?.mimeType ?? "";
  }
  start() {}
  stop() {
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["opus"], { type: "audio/webm" }) });
      this.onstop?.();
    });
  }
}

beforeEach(() => {
  track = { stopped: false, stop() { this.stopped = true; } };
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
    configurable: true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

const INFO: TranscriptionDirectionInfo = {
  enabled: true,
  default_language: "uk",
  accepts: ["audio/wav", "audio/webm", "audio/mp4"],
  max_upload_bytes: 16_777_216,
  whole_file_max_bytes: 26_214_400,
};

function setup(over: { picked?: string; resetKey?: string } = {}) {
  const transcribe = vi.fn(async (_file: Blob, _opts?: Record<string, unknown>) => ({ text: "Привіт, світе" }));
  const client = { transcribe } as unknown as LoomcycleClient;
  const onText = vi.fn();
  const onPick = vi.fn();
  const speech = { enabled: true, languages: { uk: { voices: [], default_voice: "" }, en: { voices: [], default_voice: "" } } };
  const hook = renderHook(
    ({ resetKey }) => useVoiceInput(client, INFO, speech, { picked: over.picked, onPick, host: undefined, onText, resetKey }),
    { initialProps: { resetKey: over.resetKey ?? "c1" } },
  );
  return { ...hook, transcribe, onText, onPick };
}

describe("micUnavailable", () => {
  it("says why the page cannot record", () => {
    expect(micUnavailable({ isSecureContext: false, getUserMedia: false, mediaRecorder: true })).toBe(
      "Voice input needs HTTPS (or localhost).",
    );
    expect(micUnavailable({ isSecureContext: true, getUserMedia: true, mediaRecorder: false })).toBe(
      "This browser cannot record audio.",
    );
    expect(micUnavailable({ isSecureContext: true, getUserMedia: true, mediaRecorder: true })).toBeNull();
  });
});

describe("useVoiceInput", () => {
  it("offers nothing without the transcription direction", () => {
    const client = {} as LoomcycleClient;
    const { result } = renderHook(() =>
      useVoiceInput(client, null, null, { picked: undefined, onPick: vi.fn(), host: undefined, onText: vi.fn(), resetKey: "c1" }),
    );
    expect(result.current).toBeNull();
  });

  it("disables the mic outside a secure context and says why", () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const { result } = setup();
    expect(result.current?.unavailable).toBe("Voice input needs HTTPS (or localhost).");
    act(() => result.current!.start());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("transcribes in the conversation's language and hands the text to the composer", async () => {
    const { result, transcribe, onText } = setup({ picked: "en" });
    expect(result.current?.languages).toEqual(["uk", "en"]);
    expect(result.current?.language).toBe("en");
    act(() => result.current!.start());
    await waitFor(() => expect(result.current!.state.status).toBe("recording"));
    act(() => result.current!.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", false));
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), {
      signal: expect.any(AbortSignal),
      contentType: "audio/webm",
      filename: "recording.webm",
      language: "en",
    });
    expect(track.stopped).toBe(true);
  });

  it("never puts Qwen3-ASR's header in the draft: a header alone means no speech", async () => {
    const { result, transcribe, onText } = setup();
    transcribe.mockResolvedValueOnce({ text: "language None<asr_text>" });
    act(() => result.current!.start());
    await waitFor(() => expect(result.current!.state.status).toBe("recording"));
    act(() => result.current!.stop());
    await waitFor(() => expect(result.current!.state.status).toBe("error"));
    expect(result.current!.state.error).toBe("No speech was recognised. Check that the level bar moves while you speak.");
    expect(onText).not.toHaveBeenCalled();

    transcribe.mockResolvedValueOnce({ text: "language English<asr_text>Hello there." });
    act(() => result.current!.dismiss());
    act(() => result.current!.start());
    await waitFor(() => expect(result.current!.state.status).toBe("recording"));
    act(() => result.current!.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Hello there.", false));
  });

  it("defaults to the server's language", () => {
    const { result } = setup();
    expect(result.current?.language).toBe("uk");
  });

  it("releases the microphone when the conversation changes", async () => {
    const { result, rerender, transcribe } = setup();
    act(() => result.current!.start());
    await waitFor(() => expect(result.current!.state.status).toBe("recording"));
    rerender({ resetKey: "c2" });
    expect(track.stopped).toBe(true);
    expect(result.current!.state.status).toBe("idle");
    await act(async () => undefined);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("stops recording when the tab is hidden, keeping what was said", async () => {
    const { result, onText } = setup();
    act(() => result.current!.start());
    await waitFor(() => expect(result.current!.state.status).toBe("recording"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", false));
  });

  describe("push-to-talk (RFC FX §7.1)", () => {
    // Date.now, which times the press, under the test's control.
    let clock = 0;
    beforeEach(() => {
      clock = 1_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
    });
    afterEach(() => vi.restoreAllMocks());

    it("hands a held take over to be sent", async () => {
      const { result, onText } = setup();
      act(() => result.current!.press());
      await waitFor(() => expect(result.current!.state.status).toBe("recording"));
      clock += 2_000;
      act(() => result.current!.release(true));
      await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", true));
    });

    it("keeps a tap recording hands-free, and puts it in the draft unsent", async () => {
      const { result, onText } = setup();
      act(() => result.current!.press());
      await waitFor(() => expect(result.current!.state.status).toBe("recording"));
      clock += 120;
      act(() => result.current!.release(true));
      expect(result.current!.state.status).toBe("recording");
      clock += 5_000;
      act(() => result.current!.press()); // the next tap stops it
      act(() => result.current!.release(true));
      await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", false));
    });

    it("discards a hold released off the mic", async () => {
      const { result, transcribe } = setup();
      act(() => result.current!.press());
      await waitFor(() => expect(result.current!.state.status).toBe("recording"));
      clock += 2_000;
      act(() => result.current!.release(false));
      expect(result.current!.state.status).toBe("idle");
      expect(track.stopped).toBe(true);
      await act(async () => undefined);
      expect(transcribe).not.toHaveBeenCalled();
    });

    it("drops a hold that ended before the microphone was live", async () => {
      const { result, transcribe } = setup();
      act(() => {
        result.current!.press();
        clock += 1_500;
        result.current!.release(true);
      });
      await act(async () => undefined);
      expect(result.current!.state.status).toBe("idle");
      expect(track.stopped).toBe(true);
      expect(transcribe).not.toHaveBeenCalled();
    });

    it("never times the send of a retried take", async () => {
      const { result, transcribe, onText } = setup();
      transcribe.mockRejectedValueOnce(new Error("the speech engine failed"));
      act(() => result.current!.press());
      await waitFor(() => expect(result.current!.state.status).toBe("recording"));
      clock += 2_000;
      act(() => result.current!.release(true));
      await waitFor(() => expect(result.current!.state.canRetry).toBe(true));
      act(() => result.current!.retry());
      await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", false));
    });

    it("taps from the keyboard: start, then stop into the draft", async () => {
      const { result, onText } = setup();
      act(() => result.current!.tap());
      await waitFor(() => expect(result.current!.state.status).toBe("recording"));
      act(() => result.current!.tap());
      await waitFor(() => expect(onText).toHaveBeenCalledWith("Привіт, світе", false));
    });
  });
});
