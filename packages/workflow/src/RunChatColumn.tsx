import { useState, type ReactNode } from "react";
import { isTerminal, rowPhase, visitNumbers, type WalkRunRow } from "./lib/runs";
import type { RunChatTarget } from "./types";

// Run mode's right column for a state that ran: the conversation of one of
// its runs, in the HOST's chat (the package has none). A state that ran more
// than once — a wave, a revisit — gets a picker; the default is the run going
// now, else the latest. "Details" switches back to the Inspector (the runs
// list, prompts, results).

export interface RunChatColumnProps {
  state: string;
  /** The state's runs, in order (lib/runs.ts rowsForState). */
  rows: readonly WalkRunRow[];
  renderRunChat: (run: RunChatTarget) => ReactNode;
  onDetails: () => void;
}

export function RunChatColumn({ state, rows, renderRunChat, onDetails }: RunChatColumnProps) {
  const [picked, setPicked] = useState<string>();
  const live = [...rows].reverse().find((r) => !isTerminal(r.status));
  const run = rows.find((r) => r.runId === picked) ?? live ?? rows[rows.length - 1];
  const visits = visitNumbers(rows);

  return (
    <aside className="lb-wf-runchat" aria-label={`Conversation of ${state}`}>
      <header className="lb-wf-runchat__head">
        <strong title={run.agent}>{run.agent}</strong>
        {rows.length > 1 && (
          <select
            aria-label="Run"
            value={run.runId}
            onChange={(e) => setPicked(e.target.value)}
          >
            {rows.map((r, i) => (
              <option key={r.runId} value={r.runId}>
                {`#${i + 1}${visits.get(r.runId) ? ` · visit ${visits.get(r.runId)}` : ""} · ${rowPhase(r)}`}
              </option>
            ))}
          </select>
        )}
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={onDetails}>
          Details
        </button>
      </header>
      <div className="lb-wf-runchat__body">
        {/* Keyed by run, so switching runs opens that conversation afresh. */}
        <div key={run.runId} className="lb-wf-runchat__chat">
          {renderRunChat({ runId: run.runId, agent: run.agent, state, live: !isTerminal(run.status) })}
        </div>
      </div>
    </aside>
  );
}
