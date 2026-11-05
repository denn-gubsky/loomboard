import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LoomcycleError, type LoomcycleClient, type SpeechDirectionInfo } from "@loomcycle/client";
import { pickSpeechFormat, speechLanguage, splitForSpeech } from "../lib/speech";
import { createSpeechPlayer, type AudioLike, type SpeechPlayerState } from "../lib/speechPlayer";
import { describeError } from "../lib/errors";

/** Read-aloud as the message controls use it. */
export interface ReadAloud {
  state: SpeechPlayerState;
  /** Read a reply aloud; call it from the click (see createSpeechPlayer). */
  play(key: string, text: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

// Provided by <Chat>, read by each reply's speaker button. Null when read-aloud
// is not offered, or outside a chat.
export const ReadAloudContext = createContext<ReadAloud | null>(null);

export function useReadAloudContext(): ReadAloud | null {
  return useContext(ReadAloudContext);
}

/** Whether the server offers read-aloud to this caller, and how. Asked once
 *  per client, never by trying a request: `whoami` says whether the engine is
 *  on and the caller passes the route's gates (loomcycle 1.140+), and only
 *  then is `speechInfo` read. A client without speechInfo (the package's peer
 *  range starts below 1.140) or any failure means no read-aloud. */
function useSpeechOutputInfo(client: LoomcycleClient, enabled: boolean): SpeechDirectionInfo | null {
  const [info, setInfo] = useState<SpeechDirectionInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!enabled || typeof (client as Partial<LoomcycleClient>).speechInfo !== "function") return;
    let live = true;
    (async () => {
      const me = await client.whoami();
      if (!me.effective?.surfaces?.speech) return;
      const { speech } = await client.speechInfo();
      if (live && speech.enabled) setInfo(speech);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, enabled]);
  return info;
}

// A 403 (scope, access rule, an agent-limited token) or the engine switched
// off: read-aloud is not this user's any more. Anything else is one failure.
function isUnavailable(e: unknown): boolean {
  if (!(e instanceof LoomcycleError)) return false;
  return e.status === 403 || e.code === "speech_not_configured";
}

const MIME = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg" } as const;

/** Read-aloud for one chat, or null when it is not offered here. `resetKey`
 *  (the conversation) stops a reading when it changes. */
export function useReadAloud(client: LoomcycleClient, enabled: boolean, resetKey: string): ReadAloud | null {
  const info = useSpeechOutputInfo(client, enabled);
  const format = useMemo(() => {
    if (!info) return null;
    const probe = typeof Audio === "undefined" ? null : new Audio();
    return pickSpeechFormat(info.formats, (mime) => probe?.canPlayType(mime) ?? "");
  }, [info]);

  const player = useMemo(() => {
    if (!format || !info) return null;
    return createSpeechPlayer({
      synthesize: async (text, signal) => {
        const language = speechLanguage(text, info.languages);
        const r = await client.speech(text, { format, signal, ...(language ? { language } : {}) });
        return new Blob([r.bytes as BlobPart], { type: r.contentType || MIME[format] });
      },
      createAudio: () => new Audio() as unknown as AudioLike,
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      describe: describeError,
      isUnavailable,
    });
  }, [client, format, info]);

  useEffect(() => () => player?.dispose(), [player]);
  useEffect(() => () => player?.stop(), [player, resetKey]);

  const state = useSyncExternalStore(
    player ? player.subscribe : noSubscribe,
    player ? player.getState : idleState,
  );

  // Still returned once unavailable: the reply where it happened shows why,
  // and every speaker button hides (SpeakButton).
  return useMemo(() => {
    if (!player) return null;
    return {
      state,
      play: (key, text) => player.play(key, splitForSpeech(text)),
      pause: player.pause,
      resume: player.resume,
      stop: player.stop,
    };
  }, [player, state]);
}

const IDLE_STATE: SpeechPlayerState = { key: null, status: "idle", error: null, unavailable: false };
const noSubscribe = () => () => undefined;
const idleState = () => IDLE_STATE;
