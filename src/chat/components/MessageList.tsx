import { useEffect, useRef } from "react";
import { ScrollText } from "lucide-react";
import type { ChatMessage } from "../lib/eventReducer";
import Message from "./Message";
import TypingIndicator from "./TypingIndicator";

interface Props {
  messages: ChatMessage[];
  running: boolean;
  /** Stored recap summary of the conversation, shown as a ghost note at the top. */
  recap?: string;
}

// How close to the bottom (px) still counts as "pinned" — a small slack so a
// sub-pixel/last-line gap doesn't unstick us.
const STICK_THRESHOLD = 80;

export default function MessageList({ messages, running, recap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether we're following the tail. Starts pinned; set false the moment the
  // user scrolls up so streaming output can't yank them back down, true again
  // when they scroll back to the bottom.
  const stickRef = useRef(true);

  // Keep the latest output in view as it streams — but ONLY while pinned, so a
  // user reading earlier messages isn't dragged to the bottom on every delta.
  useEffect(() => {
    const el = containerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }

  // Show the waiting indicator until the agent produces visible output.
  const last = messages[messages.length - 1];
  const waiting =
    running &&
    (!last ||
      last.role === "user" ||
      (last.role === "assistant" &&
        last.status === "streaming" &&
        last.parts.length === 0));

  if (messages.length === 0 && !waiting) {
    return (
      <div className="messages empty">
        <p className="chat-empty">Send a message to begin.</p>
      </div>
    );
  }

  return (
    <div className="messages" ref={containerRef} onScroll={onScroll}>
      {recap && (
        <div className="ghost-recap" role="note">
          <span className="ghost-recap-head">
            <ScrollText size={13} /> Recap
          </span>
          <p className="ghost-recap-body">{recap}</p>
        </div>
      )}
      {messages.map((m, i) => (
        <Message key={i} message={m} />
      ))}
      {waiting && <TypingIndicator />}
    </div>
  );
}
