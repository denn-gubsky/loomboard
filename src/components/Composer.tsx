import { useState, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";

interface Props {
  disabled: boolean;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder?: string;
}

export default function Composer({
  disabled,
  running,
  onSend,
  onStop,
  placeholder,
}: Props) {
  const [text, setText] = useState("");

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Message…"}
        rows={1}
        disabled={disabled}
      />
      {running ? (
        <button className="composer-btn stop" onClick={onStop} title="Stop">
          <Square size={16} />
        </button>
      ) : (
        <button
          className="composer-btn"
          onClick={submit}
          disabled={disabled || !text.trim()}
          title="Send"
        >
          <Send size={16} />
        </button>
      )}
    </div>
  );
}
