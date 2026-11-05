import { FileText } from "lucide-react";
import type { ChatMessage } from "../lib/eventReducer";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ToolCard from "./ToolCard";
import CopyButton from "./CopyButton";
import SpeakButton from "./SpeakButton";
import { answerText } from "../lib/speech";
import { useReadAloudContext } from "../hooks/useReadAloud";

/** `speechKey` names the reply to read-aloud; without it there is no speaker. */
export default function Message({ message, speechKey }: { message: ChatMessage; speechKey?: string }) {
  const speech = useReadAloudContext();
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
  // Copy (and read aloud) the answer text — not thinking or tool output.
  const copyText = answerText(message.parts);
  // The actions show on hover; keep them up while this reply is read aloud, or
  // says why reading it failed.
  const speaking =
    speechKey !== undefined && (speech?.state.key === speechKey || speech?.state.error?.key === speechKey);

  return (
    <div className="msg assistant">
      <div className="bubble">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <Markdown key={i} streaming={streaming}>
                {part.text}
              </Markdown>
            );
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
          <div className={speaking ? "msg-actions active" : "msg-actions"}>
            <CopyButton text={copyText} title="Copy message" />
            {speechKey !== undefined && <SpeakButton speechKey={speechKey} text={copyText} />}
          </div>
        )}
      </div>
    </div>
  );
}
