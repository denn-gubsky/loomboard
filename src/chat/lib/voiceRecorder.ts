/** Where the mic is. `starting` is the wait for the microphone (and its
 *  permission prompt); `transcribing` may also wait in loomcycle's engine
 *  queue, so it has no timeout of its own, only cancel. */
export type RecorderStatus = "idle" | "starting" | "recording" | "transcribing" | "error";

export interface VoiceRecorderState {
  status: RecorderStatus;
  /** When the recording began (deps.now), for the timer; null otherwise. */
  startedAt: number | null;
  error: string | null;
  /** The recording failed to transcribe and is kept: retry sends it again. */
  canRetry: boolean;
}

/** The part of MediaRecorder the controller uses, so tests can drive it. */
export interface RecorderLike {
  readonly mimeType: string;
  start(): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

export interface VoiceRecorderDeps {
  /** The microphone; asks for permission the first time. */
  getUserMedia(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): RecorderLike;
  /** The recording as voice input's WAV; throws when it cannot be decoded. */
  toWav(recording: Blob): Promise<Blob>;
  /** Whether the recording may be sent as it is when toWav fails. */
  canSend(recording: Blob): boolean;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  /** The transcript, for the composer. Never sent from here (RFC FX D2). */
  onText(text: string): void;
  describe(e: unknown): string;
  /** The recording stops by itself after this long. */
  limitSeconds: number;
  now?(): number;
}

export interface VoiceRecorder {
  getState(): VoiceRecorderState;
  subscribe(listener: () => void): () => void;
  /** The live microphone stream while recording, for a level meter. */
  getStream(): MediaStream | null;
  /** Call from the click: the permission prompt needs the gesture. */
  start(): void;
  /** Stop recording and transcribe what was said. */
  stop(): void;
  /** Drop the recording (or the transcription in flight) and free the mic. */
  cancel(): void;
  /** Send a recording that failed to transcribe again. */
  retry(): void;
  /** Clear an error, dropping its recording. */
  dismiss(): void;
}

const IDLE: VoiceRecorderState = { status: "idle", startedAt: null, error: null, canRetry: false };

function microphoneError(e: unknown, describe: (e: unknown) => string): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was denied.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return describe(e);
}

/** Voice input of one chat: record, stop, turn the recording into WAV, send
 *  it to loomcycle, and hand the transcript to the composer. One recording at
 *  a time; the microphone is released as soon as recording ends. */
export function createVoiceRecorder(deps: VoiceRecorderDeps): VoiceRecorder {
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let state = IDLE;
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  // The recording a failed transcription keeps for retry.
  let kept: Blob | null = null;
  // Bumped by every start, retry and cancel: work of an older generation
  // finishing late changes nothing.
  let generation = 0;

  function set(next: VoiceRecorderState) {
    state = next;
    for (const l of listeners) l();
  }

  function release() {
    if (timer) clearTimeout(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  async function send(gen: number, recording: Blob) {
    kept = recording;
    set({ status: "transcribing", startedAt: null, error: null, canRetry: false });
    const ctl = new AbortController();
    abort = ctl;
    try {
      let audio: Blob;
      try {
        audio = await deps.toWav(recording);
      } catch {
        if (!deps.canSend(recording)) throw new Error("This recording could not be prepared for sending.");
        audio = recording;
      }
      if (gen !== generation) return;
      const text = (await deps.transcribe(audio, ctl.signal)).trim();
      if (gen !== generation) return;
      kept = null;
      if (!text) {
        set({ status: "error", startedAt: null, error: "No speech was recognised.", canRetry: false });
        return;
      }
      set(IDLE);
      deps.onText(text);
    } catch (e) {
      if (gen !== generation) return; // cancelled: the abort lands here
      set({ status: "error", startedAt: null, error: deps.describe(e), canRetry: true });
    } finally {
      if (abort === ctl) abort = null;
    }
  }

  async function start() {
    if (state.status === "starting" || state.status === "recording" || state.status === "transcribing") return;
    const gen = ++generation;
    kept = null;
    set({ status: "starting", startedAt: null, error: null, canRetry: false });
    let mic: MediaStream;
    try {
      mic = await deps.getUserMedia();
    } catch (e) {
      if (gen === generation) set({ status: "error", startedAt: null, error: microphoneError(e, deps.describe), canRetry: false });
      return;
    }
    if (gen !== generation) {
      // Cancelled while the permission prompt was up.
      mic.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = mic;
    const chunks: Blob[] = [];
    const rec = deps.createRecorder(mic);
    recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      release();
      if (gen !== generation) return;
      void send(gen, new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || "" }));
    };
    rec.start();
    set({ status: "recording", startedAt: now(), error: null, canRetry: false });
    timer = setTimeout(stop, deps.limitSeconds * 1000);
  }

  function stop() {
    if (state.status !== "recording" || !recorder) return;
    if (timer) clearTimeout(timer);
    timer = null;
    set({ status: "transcribing", startedAt: null, error: null, canRetry: false });
    recorder.stop();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStream: () => stream,
    start: () => void start(),
    stop,
    cancel() {
      generation++;
      abort?.abort();
      abort = null;
      const rec = recorder;
      release();
      try {
        rec?.stop();
      } catch {
        // already inactive
      }
      kept = null;
      if (state !== IDLE) set(IDLE);
    },
    retry() {
      if (state.status !== "error" || !kept) return;
      void send(++generation, kept);
    },
    dismiss() {
      if (state.status !== "error") return;
      kept = null;
      set(IDLE);
    },
  };
}
