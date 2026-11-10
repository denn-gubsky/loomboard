import type { ChatMessage } from "./eventReducer";
import { answerText } from "./speech";

/** What to do, once a turn a voice message started has stopped running:
 *  read a reply (its speech key, the message's index, and its answer text),
 *  wait while its last reply is still settling, or read nothing — the turn
 *  failed, or said nothing but tool calls (RFC FX §7.3). Pure. */
export type ReplyToRead = { kind: "read"; key: string; text: string } | { kind: "wait" } | { kind: "none" };

/** The reply to read among `messages[from…]`: the last reply with something
 *  to say, when the newest one finished cleanly. Pure. */
export function replyToRead(messages: readonly ChatMessage[], from: number): ReplyToRead {
  let newest = true;
  for (let i = messages.length - 1; i >= from; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (newest) {
      if (m.status === "streaming") return { kind: "wait" };
      if (m.status !== "done") return { kind: "none" };
      newest = false;
    }
    const text = answerText(m.parts);
    if (text) return { kind: "read", key: String(i), text };
  }
  return { kind: "none" };
}
