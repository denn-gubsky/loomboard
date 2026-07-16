import { useState, type FormEvent } from "react";
import { HelpCircle, Send, Loader2, XCircle } from "lucide-react";
import { optionsToArray, type InterruptionInfo } from "../lib/events";
import { describeError } from "../lib/errors";

interface Props {
  interrupt: InterruptionInfo;
  onResolve: (answer: string) => Promise<void>;
  /** Cancel the pending request instead of answering — stops the Interruption
   *  tool call and parks the run (session intact). Also bound to Esc. */
  onCancel: () => void;
}

// The agent has paused to ask the operator something (v0.8.16 Interruption).
// Render the question with its declared options (or a free-text field) and
// resolve it; the run resumes on the same event stream. If the operator can't or
// won't answer, Cancel (or Esc) stops the pending request and parks the run —
// the chat stays alive to continue (RFC BH turn-cancel), it isn't terminated.
export default function InterruptCard({ interrupt, onResolve, onCancel }: Props) {
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
        <div className="interrupt-head-spacer" />
        {interrupt.priority && <span className="prio-badge">{priority}</span>}
        <button
          type="button"
          className="interrupt-cancel"
          onClick={onCancel}
          disabled={busy}
          title="Cancel this request (Esc) — keeps the chat"
        >
          <XCircle size={14} /> Cancel
        </button>
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
