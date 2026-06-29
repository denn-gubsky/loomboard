import type { ChatMessage } from "../lib/eventReducer";

// Step-5 rendering: structurally complete (parts in order, streaming cursor,
// errors) but plain-text. The rich-rendering step swaps the text/thinking/tool
// blocks for Markdown + KaTeX, ThinkingBlock, and ToolCard.
export default function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="msg assistant">
      <div className="bubble">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="md">
                {part.text}
              </div>
            );
          }
          if (part.type === "thinking") {
            return (
              <details key={i} className="thinking">
                <summary>Thinking</summary>
                <div className="md">{part.text}</div>
              </details>
            );
          }
          return (
            <div key={i} className="tool">
              <div className="tool-name">{part.call.name}</div>
              {part.call.result !== undefined && (
                <pre
                  className={part.call.isError ? "tool-result error" : "tool-result"}
                >
                  {part.call.result}
                </pre>
              )}
            </div>
          );
        })}

        {message.status === "streaming" && <span className="cursor">▋</span>}
        {message.status === "error" && (
          <div className="msg-error">{message.error}</div>
        )}
      </div>
    </div>
  );
}
