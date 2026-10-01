import { useEffect, useState } from "react";
import { rowPhase, type WalkRunRow } from "../lib/runs";
import type { RunDetail, RunPrompt } from "../types";

// The runs a selected state started in this walk (RFC CZ M3b, C13).
//
// Read from the RUN, not from a canvas cache: the list comes from the walk
// view (status and identity only), and a run's answer and prompt are read
// from the run itself when its row is opened — so what is shown is what the
// runtime stored, and a reload shows the same.
//
// Model output is UNTRUSTED: it is rendered as plain text in a <pre>, never as
// markup (CLAUDE.md security rule 7).

export interface RunsPanelProps {
  rows: WalkRunRow[];
  readRun?: (runId: string) => Promise<RunDetail>;
  readRunPrompt?: (runId: string) => Promise<RunPrompt>;
}

export function RunsPanel({ rows, readRun, readRunPrompt }: RunsPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) {
    return (
      <section className="lb-wf-runs">
        <h3 className="lb-wf-team__title">Runs</h3>
        <p className="lb-wf-team__hint">This node has started no run in this walk yet.</p>
      </section>
    );
  }
  return (
    <section className="lb-wf-runs" aria-label="Runs">
      <h3 className="lb-wf-team__title">Runs</h3>
      <ul className="lb-wf-runs__list">
        {rows.map((r) => {
          const phase = rowPhase(r);
          const where = [
            r.stateVisit && r.stateVisit > 1 ? `visit ${r.stateVisit}` : "",
            r.waveIndex !== undefined ? `#${r.waveIndex + 1}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={r.runId} className={`lb-wf-runs__row lb-wf-runs__row--${phase}`}>
              <button
                type="button"
                className="lb-wf-runs__head"
                aria-expanded={open === r.runId}
                onClick={() => setOpen((o) => (o === r.runId ? null : r.runId))}
              >
                <span className="lb-wf-runs__phase">{phase}</span>
                <span className="lb-wf-runs__agent">{r.agent}</span>
                {where && <span className="lb-wf-runs__where">{where}</span>}
              </button>
              {phase === "held" && (
                <div className="lb-wf-runs__note">
                  held for review{r.awaitedOn ? ` by ${r.awaitedOn}` : ""}
                  {r.holdExpiresAt ? ` · rejected if unruled by ${r.holdExpiresAt}` : ""}
                </div>
              )}
              {open === r.runId && <RunDetailView runId={r.runId} readRun={readRun} readRunPrompt={readRunPrompt} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RunDetailView({
  runId,
  readRun,
  readRunPrompt,
}: {
  runId: string;
  readRun?: (runId: string) => Promise<RunDetail>;
  readRunPrompt?: (runId: string) => Promise<RunPrompt>;
}) {
  const [tab, setTab] = useState<"result" | "prompt">("result");
  const [detail, setDetail] = useState<RunDetail>();
  const [prompt, setPrompt] = useState<RunPrompt>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    readRun?.(runId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      cancelled = true;
    };
  }, [runId, readRun]);

  // The prompt only when asked for: it can be large, and most rows are
  // opened for their answer.
  useEffect(() => {
    if (tab !== "prompt" || prompt || !readRunPrompt) return;
    let cancelled = false;
    readRunPrompt(runId)
      .then((p) => !cancelled && setPrompt(p))
      .catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      cancelled = true;
    };
  }, [tab, runId, prompt, readRunPrompt]);

  return (
    <div className="lb-wf-runs__detail">
      <div className="lb-wf-runs__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "result"} onClick={() => setTab("result")}>
          Result
        </button>
        {readRunPrompt && (
          <button type="button" role="tab" aria-selected={tab === "prompt"} onClick={() => setTab("prompt")}>
            Prompt
          </button>
        )}
      </div>
      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
      {tab === "result" &&
        (detail ? (
          <>
            <div className="lb-wf-runs__meta">
              {detail.status}
              {detail.model ? ` · ${detail.model}` : ""}
              {detail.outputTokens !== undefined ? ` · ${detail.inputTokens ?? 0} in / ${detail.outputTokens} out` : ""}
            </div>
            {detail.error && <div className="lb-wf-finding lb-wf-finding--error">{detail.error}</div>}
            {detail.structured && <pre className="lb-wf-json">{JSON.stringify(detail.structured, null, 2)}</pre>}
            <pre className="lb-wf-runs__text">{detail.finalText || (detail.status === "running" ? "(still running)" : "(no answer)")}</pre>
          </>
        ) : (
          !error && <p className="lb-wf-team__hint">Loading…</p>
        ))}
      {tab === "prompt" &&
        (prompt ? (
          <>
            <div className="lb-wf-runs__meta">system — exactly as sent, after {"{{…}}"} expansion</div>
            <pre className="lb-wf-runs__text">{prompt.system || "(none)"}</pre>
            <div className="lb-wf-runs__meta">input</div>
            <pre className="lb-wf-runs__text">{prompt.input || "(none)"}</pre>
          </>
        ) : (
          !error && <p className="lb-wf-team__hint">Loading…</p>
        ))}
    </div>
  );
}
