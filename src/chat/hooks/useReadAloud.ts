import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { LoomcycleError, type LoomcycleClient, type SpeechDirectionInfo } from "@loomcycle/client";
import { pickSpeechFormat, splitForSpeech } from "../lib/speech";
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

// A 403 (scope, access rule, an agent-limited token) or the engine switched
// off: read-aloud is not this user's any more. Anything else is one failure.
function isUnavailable(e: unknown): boolean {
  if (!(e instanceof LoomcycleError)) return false;
  return e.status === 403 || e.code === "speech_not_configured";
}

const MIME = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg" } as const;

/** Read-aloud for one chat, or null when it is not offered here (`info` is
 *  useSpeechCaps' speech direction). `resetKey` (the conversation) stops a
 *  reading when it changes. */
export function useReadAloud(
  client: LoomcycleClient,
  info: SpeechDirectionInfo | null,
  resetKey: string,
): ReadAloud | null {
  const format = useMemo(() => {
    if (!info) return null;
    const probe = typeof Audio === "undefined" ? null : new Audio();
    return pickSpeechFormat(info.formats, (mime) => probe?.canPlayType(mime) ?? "");
  }, [info]);

  const player = useMemo(() => {
    if (!format || !info) return null;
    return createSpeechPlayer({
      synthesize: async (text, signal) => {
        const r = await client.speech(text, { format, signal });
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
