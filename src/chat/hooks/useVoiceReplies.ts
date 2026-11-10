import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "../lib/eventReducer";
import { replyToRead } from "../lib/voiceReplies";
import type { ReadAloud } from "./useReadAloud";

/** Voice conversation mode's bookkeeping (RFC FX §7.3). */
export interface VoiceReplies {
  /** A message was just sent; `read` when it came from the mic and the mode
   *  is on. `at` is the message count before it, where its turn's replies start. */
  sent(read: boolean, at: number): void;
  /** The user stopped the turn: read nothing for it. */
  cancel(): void;
}

/** Reads the reply of a turn that a voice message started, once the turn has
 *  run and stopped. A typed message clears it; so do Stop and a conversation
 *  switch. Reading starts at the end of the turn, not while it streams. */
export function useVoiceReplies(
  readAloud: ReadAloud | null,
  running: boolean,
  messages: readonly ChatMessage[],
  resetKey: string,
): VoiceReplies {
  // The turn awaiting its reply: where its messages start, and whether it has
  // been seen running yet (a send's turn starts a moment after the send).
  const pending = useRef<{ from: number; started: boolean } | null>(null);

  useEffect(() => {
    pending.current = null;
  }, [resetKey]);

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (running) {
      p.started = true;
      return;
    }
    if (!p.started) return;
    const next = replyToRead(messages, p.from);
    if (next.kind === "wait") return;
    pending.current = null;
    if (next.kind === "read") readAloud?.play(next.key, next.text);
  }, [running, messages, readAloud]);

  return useMemo(
    () => ({
      sent(read, at) {
        pending.current = read ? { from: at, started: false } : null;
      },
      cancel() {
        pending.current = null;
      },
    }),
    [],
  );
}
