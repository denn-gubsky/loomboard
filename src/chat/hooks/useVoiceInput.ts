import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { LoomcycleClient, SpeechDirectionInfo, TranscriptionDirectionInfo } from "@loomcycle/client";
import { canSendRecording, recordingLimitSeconds, voiceLanguage, voiceLanguages } from "../lib/voiceInput";
import { createVoiceRecorder, type RecorderLike, type VoiceRecorderState } from "../lib/voiceRecorder";
import { recordingToWav } from "../lib/wav";
import { describeError } from "../lib/errors";

/** Voice input as the composer's mic uses it. */
export interface VoiceInput {
  state: VoiceRecorderState;
  start(): void;
  stop(): void;
  cancel(): void;
  retry(): void;
  dismiss(): void;
  /** The microphone while recording, for the level meter. */
  stream(): MediaStream | null;
  limitSeconds: number;
  /** The languages offered, and the one a recording is transcribed in. */
  languages: string[];
  language: string | undefined;
  pickLanguage(language: string): void;
  /** Why this page cannot record, e.g. plain HTTP; null when it can. */
  unavailable: string | null;
}

interface Platform {
  isSecureContext: boolean;
  getUserMedia: boolean;
  mediaRecorder: boolean;
}

/** Why the page cannot record, or null. Pure. */
export function micUnavailable(p: Platform): string | null {
  // getUserMedia exists only in secure contexts: a loomboard served over plain
  // HTTP on a LAN name (the Docker image on TrueNAS) has no microphone.
  if (!p.isSecureContext) return "Voice input needs HTTPS (or localhost).";
  if (!p.getUserMedia || !p.mediaRecorder) return "This browser cannot record audio.";
  return null;
}

function platform(): Platform {
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    mediaRecorder: typeof MediaRecorder !== "undefined",
  };
}

// The recorder's own format, for the fallback when WAV conversion fails: the
// first the browser makes of those loomcycle reads whole without ffmpeg.
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

function createRecorder(stream: MediaStream): RecorderLike {
  const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const recorder: RecorderLike = {
    get mimeType() {
      return media.mimeType;
    },
    start: () => media.start(),
    stop: () => media.stop(),
    ondataavailable: null,
    onstop: null,
  };
  media.ondataavailable = (e) => recorder.ondataavailable?.(e);
  media.onstop = () => recorder.onstop?.();
  return recorder;
}

const EXTENSION: Record<string, string> = { "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" };

interface Options {
  /** The language picked for this conversation, and how to keep a new pick. */
  picked: string | undefined;
  onPick(language: string): void;
  /** The host's preferred language (ChatProps.voice.language). */
  host: string | undefined;
  /** The only languages the host offers (ChatProps.voice.languages). */
  hostLanguages?: readonly string[];
  /** Where a transcript goes: the composer, at its caret. */
  onText(text: string): void;
  /** The conversation: a recording is dropped when it changes. */
  resetKey: string;
}

/** Voice input for one chat, or null where loomcycle does not offer
 *  transcription to this user (`transcription` is useSpeechCaps' half). */
export function useVoiceInput(
  client: LoomcycleClient,
  transcription: TranscriptionDirectionInfo | null,
  speech: SpeechDirectionInfo | null,
  opts: Options,
): VoiceInput | null {
  const languages = useMemo(
    () =>
      transcription
        ? voiceLanguages(transcription, speech, opts.host, navigator.languages ?? [], opts.hostLanguages)
        : [],
    [transcription, speech, opts.host, opts.hostLanguages],
  );
  const language = transcription
    ? voiceLanguage(languages, opts.picked, opts.host, transcription.default_language, navigator.languages ?? [])
    : undefined;

  // Read at send time, so a recording made before a pick or a re-render uses
  // what is current then, without rebuilding the recorder.
  const latest = useRef({ language, onText: opts.onText });
  latest.current = { language, onText: opts.onText };

  const unavailable = useMemo(() => micUnavailable(platform()), []);
  const limitSeconds = transcription ? recordingLimitSeconds(transcription) : 0;

  const recorder = useMemo(() => {
    if (!transcription || unavailable) return null;
    return createVoiceRecorder({
      getUserMedia: () =>
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
      createRecorder,
      toWav: recordingToWav,
      canSend: (recording) => canSendRecording(transcription, recording),
      transcribe: async (audio, signal) => {
        const type = audio.type.split(";")[0];
        const { language: lang } = latest.current;
        const r = await client.transcribe(audio, {
          signal,
          contentType: type,
          filename: `recording.${EXTENSION[type] ?? "bin"}`,
          ...(lang ? { language: lang } : {}),
        });
        return r.text;
      },
      onText: (text) => latest.current.onText(text),
      describe: describeError,
      limitSeconds: recordingLimitSeconds(transcription),
    });
  }, [client, transcription, unavailable]);

  // A recording belongs to its conversation and its page: drop it on a switch
  // or unmount, and stop it (keeping what was said) when the tab is hidden
  // (RFC FX D8).
  useEffect(() => () => recorder?.cancel(), [recorder, opts.resetKey]);
  useEffect(() => {
    if (!recorder) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") recorder.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [recorder]);

  const state = useSyncExternalStore(recorder ? recorder.subscribe : noSubscribe, recorder ? recorder.getState : idle);

  return useMemo(() => {
    if (!transcription) return null;
    return {
      state,
      start: () => recorder?.start(),
      stop: () => recorder?.stop(),
      cancel: () => recorder?.cancel(),
      retry: () => recorder?.retry(),
      dismiss: () => recorder?.dismiss(),
      stream: () => recorder?.getStream() ?? null,
      limitSeconds,
      languages,
      language,
      pickLanguage: opts.onPick,
      unavailable,
    };
  }, [transcription, recorder, state, limitSeconds, languages, language, opts.onPick, unavailable]);
}

const IDLE: VoiceRecorderState = { status: "idle", startedAt: null, error: null, canRetry: false };
const noSubscribe = () => () => undefined;
const idle = () => IDLE;
