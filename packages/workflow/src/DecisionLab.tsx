import { useEffect, useMemo, useState } from "react";
import { DecisionQuestionsEditor } from "./inspector/DecisionQuestionsEditor";
import { ANY_MODEL, questionFaults, type HandlerPatch } from "./lib/decision";
import { answerRows, percent, scoreText, type AnswerRow } from "./lib/decisionAnswer";
import type { JsonObject } from "./lib/model";
import { parseDefinition } from "./lib/teamJson";
import type { DecisionCallAnswer, DecisionModelInfo, WorkflowDataLayer } from "./types";

// The Decision lab (RFC EE item 1): try a decision's questions against a
// decision model before they go into a team.
//
// The operator writes what the questions are about (a JSON object) and the
// questions, picks a model, and asks. Each Ask is a real call: the runtime
// charges it to the caller and counts it against the caller's token budget.
//
// The lab keeps nothing. Its draft lives here for as long as the panel is
// open; a team cannot hold it (the runtime refuses a key it does not know),
// and once the questions are right they go into a Decision node — which is
// what "Use on <node>" does.

export interface DecisionLabSeed {
  /** The node the lab was opened on, if any. */
  nodeId?: string;
  questions?: JsonObject;
  about?: JsonObject;
}

export interface DecisionLabProps {
  decide: NonNullable<WorkflowDataLayer["decide"]>;
  listDecisionModels?: WorkflowDataLayer["listDecisionModels"];
  /** What the lab starts from: the selected Decision node's questions. */
  seed?: DecisionLabSeed;
  /** Write the lab's questions onto the node it was opened on. Absent: not offered. */
  onApply?: (questions: JsonObject) => void;
  onClose: () => void;
}

const START_QUESTIONS: JsonObject = {
  route: { type: "choice", instructions: "Which team should handle this ticket?", criteria: { billing: "invoices, refunds, charges", support: "bugs, outages, login problems" } },
};
const START_STATE = '{\n  "ticket": "My invoice for March was charged twice and I want my money back."\n}';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DecisionLab({ decide, listDecisionModels, seed, onApply, onClose }: DecisionLabProps) {
  const [questions, setQuestions] = useState<JsonObject>(() => (seed?.questions && Object.keys(seed.questions).length ? seed.questions : START_QUESTIONS));
  // A node's `about` holds placeholders the walk fills ({{thread.output}},
  // ${var.*}); here they are literal text, for the operator to replace with a
  // sample.
  const [stateText, setStateText] = useState(() => (seed?.about ? JSON.stringify(seed.about, null, 2) : START_STATE));
  const [models, setModels] = useState<DecisionModelInfo[]>();
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [answer, setAnswer] = useState<DecisionCallAnswer>();
  // What the answer on screen was asked about: an edit after it makes it stale.
  const [asked, setAsked] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!listDecisionModels) return;
    let cancelled = false;
    listDecisionModels()
      .then((list) => !cancelled && setModels(list))
      // Without the listing the default model is asked; nothing is blocked.
      .catch(() => !cancelled && setModels(undefined));
    return () => {
      cancelled = true;
    };
  }, [listDecisionModels]);

  const chosen = models?.find((m) => m.name === model) ?? models?.find((m) => m.default);
  const parsed = useMemo(() => parseDefinition(stateText), [stateText]);
  const stateError = parsed.ok ? undefined : `Line ${parsed.position.line}, column ${parsed.position.column}: ${parsed.message}`;
  // Held to the chosen model's own limits, which a team's save is not: here
  // the call is about to be made.
  const faults = questionFaults(questions, chosen?.limits ?? ANY_MODEL);
  const print = JSON.stringify([model, stateText, questions]);
  const stale = answer !== undefined && asked !== print;

  const patch = (p: HandlerPatch) => {
    // The lab has questions and nothing else: route and threshold are a
    // node's, and the editor is told not to offer them.
    if (p.questions !== undefined) setQuestions(p.questions as JsonObject);
  };

  const ask = async () => {
    if (!parsed.ok || faults.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const a = await decide({ ...(model ? { model } : {}), state: parsed.def, questions });
      setAnswer(a);
      setAsked(print);
    } catch (e) {
      setAnswer(undefined);
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(questions, null, 2));
      setCopied(true);
    } catch (e) {
      setError(`Could not copy: ${msg(e)}`);
    }
  };

  return (
    <aside className="lb-wf-inspector lb-wf-lab" aria-label="Decision lab">
      <header className="lb-wf-lab__head">
        <strong>Decision lab</strong>
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="lb-wf-team__hint">
        Try questions against a decision model. Each Ask is a real call, charged to you and counted against your token
        budget. Nothing here is saved.
      </p>

      <label className="lb-wf-field">
        <span className="lb-wf-field__label">Model</span>
        <select className="lb-wf-input" aria-label="Decision model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">{models?.find((m) => m.default) ? `default (${models.find((m) => m.default)!.name})` : "default"}</option>
          {(models ?? []).map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.served ? ` — ${m.served}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="lb-wf-field">
        <span className="lb-wf-field__label">About — the JSON object the questions are asked about</span>
        <textarea
          className="lb-wf-input lb-wf-lab__state"
          aria-label="What the questions are about (JSON)"
          rows={6}
          spellCheck={false}
          value={stateText}
          onChange={(e) => setStateText(e.target.value)}
        />
      </label>
      {stateError && <div className="lb-wf-finding lb-wf-finding--error">{stateError}</div>}

      <DecisionQuestionsEditor handler={{ questions }} routing={false} limits={chosen?.limits} disabled={busy} onPatch={patch} />

      <div className="lb-wf-lab__actions">
        <button type="button" className="lb-wf-btn lb-wf-btn--primary" onClick={() => void ask()} disabled={busy || !parsed.ok || faults.length > 0}>
          {busy ? "Asking…" : "Ask"}
        </button>
        <button type="button" className="lb-wf-btn" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy questions"}
        </button>
        {onApply && seed?.nodeId && (
          <button
            type="button"
            className="lb-wf-btn"
            onClick={() => onApply(questions)}
            disabled={faults.length > 0}
            title="Replaces that node's questions with these. The node's route, about and captures are left as they are."
          >
            Use on {seed.nodeId}
          </button>
        )}
      </div>

      {error && (
        <div className="lb-wf-finding lb-wf-finding--error" role="alert">
          {error}
        </div>
      )}

      {answer && (
        <section className="lb-wf-lab__answer" aria-label="Answer" data-stale={stale || undefined}>
          <h3 className="lb-wf-team__title">Answer</h3>
          {stale && <p className="lb-wf-finding lb-wf-finding--info">Asked before the last edit. Ask again to see what these questions get.</p>}
          <p className="lb-wf-team__hint">
            {answer.model ?? "the default model"}
            {answer.served_model ? ` (${answer.served_model})` : ""}
            {answer.usage ? ` · ${answer.usage.input_tokens ?? 0} tokens in, ${answer.usage.output_tokens ?? 0} out` : ""}
          </p>
          {answerRows(answer).map((r) => (
            <AnswerView key={r.question} row={r} />
          ))}
          <p className="lb-wf-team__hint">
            The probabilities are the model's judgement and are not calibrated: compare the options within one answer, and
            do not treat a fixed threshold as a guarantee.
          </p>
        </section>
      )}
    </aside>
  );
}

function Bar({ p }: { p: number }) {
  return (
    <span className="lb-wf-lab__bar" aria-hidden>
      <span style={{ width: `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%` }} />
    </span>
  );
}

function AnswerView({ row }: { row: AnswerRow }) {
  return (
    <div className="lb-wf-lab__row" data-testid={`answer-${row.question}`}>
      <code>{row.question}</code>
      {row.type === "choice" && (
        <>
          <span>
            {" "}
            → <strong>{row.choice}</strong>
          </span>
          <ul>
            {row.options.map((o) => (
              <li key={o.name}>
                <Bar p={o.probability} />
                {o.name} {percent(o.probability)}
              </li>
            ))}
          </ul>
        </>
      )}
      {row.type === "noul" && (
        <>
          <span>
            {" "}
            → yes {percent(row.yes)}
          </span>
          <ul>
            <li>
              <Bar p={row.yes} />
              yes {percent(row.yes)} · no {percent(1 - row.yes)}
            </li>
          </ul>
        </>
      )}
      {row.type === "score" && (
        <>
          <span> → {scoreText(row)}</span>
          <ul>
            {row.levels.map((l) => (
              <li key={l.position}>
                <Bar p={l.probability} />
                {l.position}
                {l.label ? ` ${l.label}` : ""} {percent(l.probability)}
              </li>
            ))}
          </ul>
        </>
      )}
      {row.type === "unknown" && <pre className="lb-wf-json">{JSON.stringify(row.raw, null, 2)}</pre>}
    </div>
  );
}
