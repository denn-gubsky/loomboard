import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/eventReducer";
import Message from "./Message";
import TypingIndicator from "./TypingIndicator";

interface Props {
  messages: ChatMessage[];
  running: boolean;
}

export default function MessageList({ messages, running }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest output in view as it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running]);

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
    <div className="messages">
      {messages.map((m, i) => (
        <Message key={i} message={m} />
      ))}
      {waiting && <TypingIndicator />}
      <div ref={endRef} />
    </div>
  );
}
