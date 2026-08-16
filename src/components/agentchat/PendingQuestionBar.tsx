import { useCallback, useState } from "react";
import { HelpCircle } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";

// The answer bar for a run parked on an agent Question. Sits atop the run's chat
// (overlay or workflow dock) so the interruption the tile advertised is
// answerable right where the user opened it. Option buttons when the ask is
// multiple-choice, else a free-text field; resolving resumes the run.
export default function PendingQuestionBar({
  client,
  runId,
  row,
}: {
  client: LoomcycleClient;
  runId: string;
  row: InterruptRow;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [resolved, setResolved] = useState(false);

  const answer = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        await client.resolveInterrupt(runId, row.interrupt_id, { answer: value });
        setResolved(true);
      } catch (e) {
        console.warn("[board] resolveInterrupt failed:", e);
        setBusy(false);
      }
    },
    [client, runId, row.interrupt_id],
  );

  if (resolved) {
    return <div className="aco-question resolved">Answer sent — the run is resuming.</div>;
  }

  const options = row.options ?? [];
  return (
    <div className="aco-question">
      <div className="aco-question-text">
        <HelpCircle size={14} /> {row.question ?? "The agent is asking for input."}
      </div>
      {options.length > 0 ? (
        <div className="aco-question-opts">
          {options.map((o) => (
            <button key={o} disabled={busy} onClick={() => void answer(o)}>
              {o}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="aco-question-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void answer(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type an answer…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
