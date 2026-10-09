import { useEffect, useState } from "react";
import type { JsonObject } from "../lib/model";
import {
  QUESTION_TYPES,
  addQuestion,
  canRoute,
  freeName,
  levelsOf,
  optionsOf,
  questionFaults,
  questionsOf,
  removeQuestion,
  renameQuestion,
  retypeQuestion,
  routeAnswers,
  routeEdge,
  setQuestion,
  setRoute,
  withOptions,
  withSide,
  type DecisionLimits,
  type HandlerPatch,
  type QuestionType,
} from "../lib/decision";

// A decision state's questions, one by one (loomcycle 1.109, RFC ED): what a
// decision model is asked, and which question's answer routes the walk.
//
// It edits the handler's `questions`, `route` and `threshold` through the
// patches in lib/decision.ts, so the raw JSON stays the source of truth and a
// field this editor does not own survives an edit. The same component serves
// the Decision lab, which has questions and no state.

const TYPE_LABELS: Record<QuestionType, string> = {
  choice: "choice — pick one option",
  noul: "yes / no",
  score: "score — a place on a scale",
};

export interface DecisionQuestionsEditorProps {
  /** The decision handler (or any object with `questions`, `route`, `threshold`). */
  handler: JsonObject;
  /** The state's outgoing transitions, to show where each answer goes.
   *  Absent: nothing is said about transitions (the lab has none). */
  edges?: readonly { on: string; to: string }[];
  /** False hides routing altogether: the lab asks, it does not route. */
  routing?: boolean;
  /** One model's own limits, where the questions are about to be sent to it
   *  (the lab). Absent: what every model asks, which is what a save checks. */
  limits?: DecisionLimits;
  disabled?: boolean;
  onPatch: (patch: HandlerPatch) => void;
  /** An option of the ROUTED question was renamed: its transition's label
   *  should follow. */
  onRenameAnswer?: (from: string, to: string) => void;
}

/** A text input that commits on blur or Enter, for a value whose every
 *  keystroke would otherwise rename a key — and re-key the row being typed in. */
function CommitInput({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function DecisionQuestionsEditor({ handler, edges, routing = true, limits, disabled, onPatch, onRenameAnswer }: DecisionQuestionsEditorProps) {
  const questions = questionsOf(handler);
  const names = questions.map(([n]) => n);
  const route = typeof handler.route === "string" ? handler.route : "";
  const faults = new Map(questionFaults(handler.questions, limits).map((f) => [f.question ?? "", f.message]));
  const [newType, setNewType] = useState<QuestionType>("choice");
  const answers = routing ? routeAnswers(handler) : undefined;
  const targets = new Map((edges ?? []).map((e) => [e.on, e.to]));
  const fallback = targets.get("success");

  return (
    <section className="lb-wf-form-editor" aria-label="Decision questions">
      <h3 className="lb-wf-team__title">Questions</h3>
      <p className="lb-wf-team__hint">
        What the decision model is asked about <code>about</code>. It answers each with probabilities and no text.
      </p>
      {faults.has("") && <div className="lb-wf-finding lb-wf-finding--error">{faults.get("")}</div>}

      {questions.map(([name, q], i) => {
        const type = (QUESTION_TYPES as readonly string[]).includes(String(q.type)) ? (q.type as QuestionType) : undefined;
        const set = (next: JsonObject) => onPatch(setQuestion(handler, name, next));
        const routed = route === name;
        return (
          <fieldset key={i} className="lb-wf-form-editor__field" disabled={disabled} data-testid={`question-${name}`}>
            <legend>
              <code>{name}</code>
            </legend>
            <label>
              Name
              <CommitInput value={name} label={`Name of question ${name}`} onCommit={(to) => onPatch(renameQuestion(handler, name, to.trim()))} />
            </label>
            <label>
              Type
              <select
                aria-label={`Type of question ${name}`}
                value={type ?? ""}
                onChange={(e) => onPatch(retypeQuestion(handler, name, e.target.value as QuestionType))}
              >
                {!type && <option value="">{String(q.type ?? "") || "—"}</option>}
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Instructions
              <textarea
                aria-label={`Instructions for question ${name}`}
                rows={2}
                value={typeof q.instructions === "string" ? q.instructions : ""}
                placeholder="What should the model decide?"
                onChange={(e) => set({ ...q, instructions: e.target.value })}
              />
            </label>

            {type === "choice" && (
              <div className="lb-wf-decision__list">
                <span className="lb-wf-team__hint">Options — the model picks one. A description is optional.</span>
                {optionsOf(q).map(([opt, desc], j, all) => (
                  <div key={j} className="lb-wf-decision__row">
                    <CommitInput
                      value={opt}
                      label={`Option ${j + 1} of question ${name}`}
                      onCommit={(to) => {
                        const next = to.trim();
                        if (!next || all.some(([o]) => o === next)) return;
                        set(withOptions(q, all.map(([o, d], k) => [k === j ? next : o, d] as const)));
                        if (routed) onRenameAnswer?.(opt, next);
                      }}
                    />
                    <input
                      aria-label={`Description of option ${opt}`}
                      value={desc}
                      placeholder="explains itself"
                      onChange={(e) => set(withOptions(q, all.map(([o, d], k) => [o, k === j ? e.target.value : d] as const)))}
                    />
                    <button
                      type="button"
                      className="lb-wf-btn"
                      aria-label={`Remove option ${opt}`}
                      onClick={() => set(withOptions(q, all.filter((_, k) => k !== j)))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="lb-wf-btn"
                  onClick={() => {
                    const all = optionsOf(q);
                    set(withOptions(q, [...all, [freeName("option", all.map(([o]) => o)), ""]]));
                  }}
                >
                  Add option
                </button>
              </div>
            )}

            {type === "noul" && (
              <div className="lb-wf-decision__list">
                <label>
                  Yes means
                  <input
                    aria-label={`What yes means for question ${name}`}
                    value={optionsOf(q).find(([k]) => k === "true")?.[1] ?? ""}
                    placeholder="optional"
                    onChange={(e) => set(withSide(q, "true", e.target.value))}
                  />
                </label>
                <label>
                  No means
                  <input
                    aria-label={`What no means for question ${name}`}
                    value={optionsOf(q).find(([k]) => k === "false")?.[1] ?? ""}
                    placeholder="optional"
                    onChange={(e) => set(withSide(q, "false", e.target.value))}
                  />
                </label>
              </div>
            )}

            {type === "score" && (
              <div className="lb-wf-decision__list">
                <span className="lb-wf-team__hint">Levels, lowest first. The answer is a position on this scale.</span>
                {levelsOf(q).map((level, j, all) => (
                  <div key={j} className="lb-wf-decision__row">
                    <span className="lb-wf-team__hint">{j}</span>
                    <input
                      aria-label={`Level ${j} of question ${name}`}
                      value={level}
                      onChange={(e) => set({ ...q, criteria: all.map((l, k) => (k === j ? e.target.value : l)) })}
                    />
                    <button
                      type="button"
                      className="lb-wf-btn"
                      aria-label={`Remove level ${j} of question ${name}`}
                      onClick={() => set({ ...q, criteria: all.filter((_, k) => k !== j) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="lb-wf-btn" onClick={() => set({ ...q, criteria: [...levelsOf(q), ""] })}>
                  Add level
                </button>
              </div>
            )}

            {routing && canRoute(q) && (
              <label className="lb-wf-form-editor__check">
                <input type="radio" name="lb-wf-decision-route" checked={routed} onChange={() => onPatch(setRoute(handler, name))} />
                its answer routes the walk
              </label>
            )}
            {routing && routed && type === "noul" && (
              <label>
                Yes at or above
                <input
                  aria-label="Yes threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={typeof handler.threshold === "number" ? handler.threshold : ""}
                  placeholder="0.5"
                  onChange={(e) => onPatch({ threshold: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </label>
            )}
            {routing && routed && answers && edges && (
              <ul className="lb-wf-decision__answers" aria-label={`Where each answer of ${name} goes`}>
                {answers.map((a) => {
                  const to = targets.get(routeEdge(a)) ?? fallback;
                  return (
                    <li key={a} className={to ? undefined : "lb-wf-finding--error"}>
                      <code>{a}</code> → {to ? <code>{to}</code> : "no transition yet — draw one from this node"}
                      {to && !targets.has(routeEdge(a)) ? " (by its success transition)" : ""}
                    </li>
                  );
                })}
              </ul>
            )}

            {faults.has(name) && <div className="lb-wf-finding lb-wf-finding--error">{faults.get(name)}</div>}
            <button type="button" className="lb-wf-btn" onClick={() => onPatch(removeQuestion(handler, name))}>
              Remove question
            </button>
          </fieldset>
        );
      })}

      {routing && (
        <label className="lb-wf-form-editor__check">
          <input type="radio" name="lb-wf-decision-route" checked={!route} disabled={disabled} onChange={() => onPatch(setRoute(handler, undefined))} />
          <span>
            no answer routes — the node advances on <code>success</code> and only binds variables
          </span>
        </label>
      )}

      <div className="lb-wf-form-editor__add">
        <select aria-label="Type of the new question" value={newType} disabled={disabled} onChange={(e) => setNewType(e.target.value as QuestionType)}>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" className="lb-wf-btn" disabled={disabled} onClick={() => onPatch(addQuestion(handler, freeName("question", names), newType))}>
          Add question
        </button>
      </div>
    </section>
  );
}
