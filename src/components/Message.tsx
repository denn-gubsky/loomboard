import type { ChatMessage } from "../lib/eventReducer";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ToolCard from "./ToolCard";

export default function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    // User text is shown verbatim (not parsed as markdown).
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  const streaming = message.status === "streaming";

  return (
    <div className="msg assistant">
      <div className="bubble">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return <Markdown key={i}>{part.text}</Markdown>;
          }
          if (part.type === "thinking") {
            return <ThinkingBlock key={i} text={part.text} streaming={streaming} />;
          }
          return <ToolCard key={i} call={part.call} />;
        })}

        {streaming && <span className="cursor">▋</span>}
        {message.status === "error" && (
          <div className="msg-error">{message.error}</div>
        )}
      </div>
    </div>
  );
}
