import { FileText } from "lucide-react";
import type { ChatMessage } from "../lib/eventReducer";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ToolCard from "./ToolCard";
import CopyButton from "./CopyButton";

export default function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    // User text is shown verbatim (not parsed as markdown).
    return (
      <div className="msg user">
        <div className="bubble">
          {message.attachments && message.attachments.length > 0 && (
            <div className="msg-atts">
              {message.attachments.map((a, i) =>
                a.kind === "image" && a.dataUrl ? (
                  <img key={i} className="msg-att-img" src={a.dataUrl} alt={a.name} />
                ) : (
                  <span key={i} className="msg-att-file">
                    <FileText size={13} /> {a.name}
                  </span>
                ),
              )}
            </div>
          )}
          {message.text}
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  // Copy the answer text (the markdown parts) — not thinking or tool output.
  const copyText = message.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n\n")
    .trim();

  return (
    <div className="msg assistant">
      <div className="bubble">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return <Markdown key={i}>{part.text}</Markdown>;
          }
          if (part.type === "thinking") {
            return (
              <ThinkingBlock
                key={i}
                text={part.text}
                active={streaming && part.durationMs === undefined}
                durationMs={part.durationMs}
              />
            );
          }
          if (part.type === "notice") {
            return (
              <div key={i} className={`notice ${part.level}`}>
                {part.text}
              </div>
            );
          }
          return <ToolCard key={i} call={part.call} />;
        })}

        {streaming && <span className="cursor">▋</span>}
        {message.status === "error" && (
          <div className="msg-error">{message.error}</div>
        )}

        {!streaming && copyText && (
          <div className="msg-actions">
            <CopyButton text={copyText} title="Copy message" />
          </div>
        )}
      </div>
    </div>
  );
}
