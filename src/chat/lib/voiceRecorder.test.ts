import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRecorder, type RecorderLike, type VoiceRecorderDeps } from "./voiceRecorder";

// A fake microphone whose tracks record whether they were stopped, and a fake
// MediaRecorder that hands over its data and fires onstop when stopped.
function harness(over: Partial<VoiceRecorderDeps> = {}) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorders: (RecorderLike & { started: boolean })[] = [];
  const texts: string[] = [];
  const transcribeCalls: { audio: Blob; signal: AbortSignal; resolve(t: string): void; reject(e: unknown): void }[] = [];
  const deps: VoiceRecorderDeps = {
    getUserMedia: vi.fn(async () => stream),
    createRecorder: () => {
      const r: RecorderLike & { started: boolean } = {
        mimeType: "audio/webm;codecs=opus",
        started: false,
        ondataavailable: null,
        onstop: null,
        start() { r.started = true; },
        stop() {
          queueMicrotask(() => {
            r.ondataavailable?.({ data: new Blob(["opus-bytes"], { type: "audio/webm" }) });
            r.onstop?.();
          });
        },
      };
      recorders.push(r);
      return r;
    },
    toWav: vi.fn(async () => new Blob(["RIFF"], { type: "audio/wav" })),
    canSend: () => false,
    transcribe: (audio, signal) =>
      new Promise<string>((resolve, reject) => transcribeCalls.push({ audio, signal, resolve, reject })),
    onText: (t) => texts.push(t),
    describe: (e) => (e instanceof Error ? e.message : String(e)),
    limitSeconds: 300,
    now: () => 1000,
    ...over,
  };
  const rec = createVoiceRecorder(deps);
  return { rec, deps, track, recorders, texts, transcribeCalls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("voiceRecorder", () => {
  it("records, then transcribes the WAV and hands the text over without sending it", async () => {
    const { rec, recorders, texts, transcribeCalls, track } = harness();
    rec.start();
    expect(rec.getState().status).toBe("starting");
    await tick();
    expect(rec.getState()).toMatchObject({ status: "recording", startedAt: 1000 });
    expect(recorders[0].started).toBe(true);

    rec.stop();
    expect(rec.getState().status).toBe("transcribing");
    await tick();
    expect(track.stopped).toBe(true); // the mic is free once recording ends
    expect(transcribeCalls[0].audio.type).toBe("audio/wav");

    transcribeCalls[0].resolve("  Привіт, світе.  ");
    await tick();
    expect(texts).toEqual(["Привіт, світе."]);
    expect(rec.getState().status).toBe("idle");
  });

  it("stops by itself at the limit", async () => {
    vi.useFakeTimers();
    const { rec, transcribeCalls } = harness({ limitSeconds: 60 });
    rec.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.getState().status).toBe("recording");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rec.getState().status).toBe("transcribing");
    expect(transcribeCalls).toHaveLength(1);
  });

  it("sends the recorder blob when WAV conversion fails and the server accepts its type", async () => {
    const { rec, transcribeCalls } = harness({
      toWav: async () => { throw new Error("EncodingError"); },
      canSend: (b) => b.type.startsWith("audio/webm"),
    });
    rec.start();
    await tick();
    rec.stop();
    await tick();
    expect(transcribeCalls[0].audio.type).toBe("audio/webm;codecs=opus");
  });

  it("says why when the recording can be neither converted nor sent", async () => {
    const { rec, transcribeCalls } = harness({ toWav: async () => { throw new Error("EncodingError"); } });
    rec.start();
    await tick();
    rec.stop();
    await tick();
    expect(transcribeCalls).toHaveLength(0);
    expect(rec.getState()).toMatchObject({ status: "error", error: "This recording could not be prepared for sending." });
  });

  it("keeps the recording for retry after a failed transcription", async () => {
    const { rec, deps, transcribeCalls, texts } = harness();
    rec.start();
    await tick();
    rec.stop();
    await tick();
    transcribeCalls[0].reject(new Error("the speech engine failed; try again later"));
    await tick();
    expect(rec.getState()).toMatchObject({ status: "error", error: "the speech engine failed; try again later", canRetry: true });

    rec.retry();
    await tick();
    expect(transcribeCalls).toHaveLength(2);
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1); // nothing re-recorded
    transcribeCalls[1].resolve("second time");
    await tick();
    expect(texts).toEqual(["second time"]);
  });

  it("aborts a waiting transcription on cancel, and hands nothing over", async () => {
    const { rec, transcribeCalls, texts } = harness();
    rec.start();
    await tick();
    rec.stop();
    await tick();
    rec.cancel();
    expect(transcribeCalls[0].signal.aborted).toBe(true);
    expect(rec.getState().status).toBe("idle");
    transcribeCalls[0].resolve("too late");
    await tick();
    expect(texts).toEqual([]);
  });

  it("discards the recording on cancel while recording, and frees the mic", async () => {
    const { rec, track, transcribeCalls } = harness();
    rec.start();
    await tick();
    rec.cancel();
    await tick();
    expect(track.stopped).toBe(true);
    expect(transcribeCalls).toHaveLength(0);
    expect(rec.getState().status).toBe("idle");
  });

  it("releases a microphone granted after cancel", async () => {
    let grant!: (s: MediaStream) => void;
    const track = { stopped: false, stop() { this.stopped = true; } };
    const { rec, recorders } = harness({ getUserMedia: () => new Promise((r) => (grant = r)) });
    rec.start();
    rec.cancel();
    grant({ getTracks: () => [track] } as unknown as MediaStream);
    await tick();
    expect(track.stopped).toBe(true);
    expect(recorders).toHaveLength(0);
    expect(rec.getState().status).toBe("idle");
  });

  it("says plainly when the microphone is refused or missing", async () => {
    for (const [name, message] of [
      ["NotAllowedError", "Microphone access was denied."],
      ["NotFoundError", "No microphone was found."],
      ["NotReadableError", "The microphone is in use by another app."],
    ]) {
      const { rec } = harness({ getUserMedia: async () => { throw new DOMException("x", name); } });
      rec.start();
      await tick();
      expect(rec.getState()).toMatchObject({ status: "error", error: message, canRetry: false });
    }
  });

  it("reports an empty transcript instead of inserting nothing", async () => {
    const { rec, transcribeCalls, texts } = harness();
    rec.start();
    await tick();
    rec.stop();
    await tick();
    transcribeCalls[0].resolve("   ");
    await tick();
    expect(texts).toEqual([]);
    expect(rec.getState()).toMatchObject({ status: "error", error: "No speech was recognised. Check that the level bar moves while you speak.", canRetry: false });
  });

  describe("with a host that gets permission itself (ensureMicrophone)", () => {
    it("asks the host first, and opens the microphone only when it says yes", async () => {
      const order: string[] = [];
      const { rec, deps } = harness({
        ensureMicrophone: vi.fn(async () => {
          order.push("ensure");
          return true;
        }),
      });
      (deps.getUserMedia as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("getUserMedia");
        return { getTracks: () => [] } as unknown as MediaStream;
      });
      rec.start();
      await tick();
      expect(order).toEqual(["ensure", "getUserMedia"]);
      expect(rec.getState().status).toBe("recording");
    });

    it("ends the take quietly when the host says not now, without touching the microphone", async () => {
      const { rec, deps } = harness({ ensureMicrophone: async () => false });
      rec.start();
      expect(rec.getState().status).toBe("starting");
      await tick();
      expect(rec.getState()).toEqual({ status: "idle", startedAt: null, error: null, canRetry: false });
      expect(deps.getUserMedia).not.toHaveBeenCalled();
    });

    it("ignores the host's late answer after the take was cancelled", async () => {
      let answer!: (ok: boolean) => void;
      const { rec, deps } = harness({ ensureMicrophone: () => new Promise<boolean>((r) => (answer = r)) });
      rec.start();
      rec.cancel();
      answer(true);
      await tick();
      expect(deps.getUserMedia).not.toHaveBeenCalled();
      expect(rec.getState().status).toBe("idle");
    });

    it("reports a host that fails as a microphone error", async () => {
      const { rec } = harness({
        ensureMicrophone: async () => {
          throw new DOMException("no", "NotAllowedError");
        },
      });
      rec.start();
      await tick();
      expect(rec.getState()).toMatchObject({ status: "error", error: "Microphone access was denied." });
    });
  });
});
