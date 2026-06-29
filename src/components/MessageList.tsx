import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/eventReducer";
import Message from "./Message";

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

  if (messages.length === 0) {
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
      <div ref={endRef} />
    </div>
  );
}
