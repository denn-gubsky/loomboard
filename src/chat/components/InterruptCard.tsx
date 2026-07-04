import { useState, type FormEvent } from "react";
import { HelpCircle, Send, Loader2 } from "lucide-react";
import { optionsToArray, type InterruptionInfo } from "../lib/events";
import { describeError } from "../lib/errors";

interface Props {
  interrupt: InterruptionInfo;
  onResolve: (answer: string) => Promise<void>;
}

// The agent has paused to ask the operator something (v0.8.16 Interruption).
// Render the question with its declared options (or a free-text field) and
// resolve it; the run resumes on the same event stream.
export default function InterruptCard({ interrupt, onResolve }: Props) {
  const options = optionsToArray(interrupt.options);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(value: string) {
    const a = value.trim();
    if (busy || !a) return;
    setBusy(true);
    setError(null);
    try {
      await onResolve(a);
      setText("");
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
    // On success the interrupt clears from state and this card unmounts.
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void answer(text);
  }

  const priority = interrupt.priority || "normal";

  return (
    <div className={`interrupt prio-${priority}`}>
      <div className="interrupt-head">
        <HelpCircle size={16} />
        <span>Agent question</span>
        {interrupt.priority && <span className="prio-badge">{priority}</span>}
      </div>

      <div className="interrupt-q">
        {interrupt.question || "The agent is awaiting your input."}
      </div>
      {interrupt.context && <div className="interrupt-ctx">{interrupt.context}</div>}

      {options.length > 0 ? (
        <div className="interrupt-opts">
          {options.map((o) => (
            <button
              key={o}
              className="opt"
              disabled={busy}
              onClick={() => answer(o)}
            >
              {o}
            </button>
          ))}
        </div>
      ) : (
        <form className="interrupt-form" onSubmit={onSubmit}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your answer…"
            disabled={busy}
            autoFocus
          />
          <button className="composer-btn" disabled={busy || !text.trim()} title="Answer">
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          </button>
        </form>
      )}

      {error && <div className="interrupt-error">{error}</div>}
    </div>
  );
}
