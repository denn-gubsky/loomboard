// A decision model's answer, as the canvas shows it (loomcycle 1.107).
//
// The runtime passes each answer through as the model gave it, and a later
// model may add fields — so nothing here assumes a shape it has not checked,
// and an answer it does not recognise is shown as the JSON it is, never
// dropped.
//
// The probabilities are a judgement, not a measurement: loomcycle's own guide
// found scores above 0.9 right 42% of the time on its default model. So this
// module orders and formats them and never grades one as "confident".
//
// Pure: no React, no network.

import type { DecisionCallAnswer } from "../types";

export type AnswerRow =
  | {
      type: "choice";
      question: string;
      /** The option picked. */
      choice: string;
      /** Every option, most probable first. */
      options: { name: string; probability: number }[];
      confidence?: number;
    }
  | {
      type: "noul";
      question: string;
      /** The probability that the answer is yes. 0 is a definite no. */
      yes: number;
    }
  | {
      type: "score";
      question: string;
      /** The expected position on the scale, counted from 0. */
      score: number;
      /** Every level, lowest first. */
      levels: { position: number; label: string; probability: number }[];
      confidence?: number;
    }
  | {
      type: "unknown";
      question: string;
      /** The answer as returned, for a shape this build does not know. */
      raw: unknown;
    };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function probabilities(v: unknown): [string, number][] {
  return isObj(v) ? Object.entries(v).flatMap(([k, p]) => (num(p) === undefined ? [] : [[k, p as number] as [string, number]])) : [];
}

function row(question: string, a: unknown): AnswerRow {
  if (!isObj(a)) return { type: "unknown", question, raw: a };
  const confidence = num(a.confidence);
  if (a.type === "choice" && typeof a.choice === "string") {
    const options = probabilities(a.probabilities)
      .map(([name, probability]) => ({ name, probability }))
      .sort((x, y) => y.probability - x.probability || (x.name < y.name ? -1 : 1));
    return { type: "choice", question, choice: a.choice, options, ...(confidence !== undefined ? { confidence } : {}) };
  }
  if (a.type === "noul" && num(a.noul) !== undefined) return { type: "noul", question, yes: a.noul as number };
  if (a.type === "score" && num(a.score) !== undefined) {
    const legend = isObj(a.legend) ? a.legend : {};
    const levels = probabilities(a.probabilities)
      .map(([k, probability]) => ({ position: Number(k), label: typeof legend[k] === "string" ? (legend[k] as string) : "", probability }))
      .filter((l) => Number.isInteger(l.position))
      .sort((x, y) => x.position - y.position);
    return { type: "score", question, score: a.score as number, levels, ...(confidence !== undefined ? { confidence } : {}) };
  }
  return { type: "unknown", question, raw: a };
}

/** One row per question answered, in name order. */
export function answerRows(answer: Pick<DecisionCallAnswer, "answers">): AnswerRow[] {
  const answers = isObj(answer.answers) ? answer.answers : {};
  return Object.keys(answers)
    .sort()
    .map((q) => row(q, answers[q]));
}

/** A probability as a percentage: one decimal below 10% and above 90%, where
 *  the difference between 0.4% and 4% matters; whole numbers between. */
export function percent(p: number): string {
  const v = Math.min(1, Math.max(0, p)) * 100;
  return `${v < 10 || v > 90 ? v.toFixed(1) : v.toFixed(0)}%`;
}

/** Where a score sits, in words: "1.8 of 0–2, nearest: everything needed". */
export function scoreText(r: Extract<AnswerRow, { type: "score" }>): string {
  const top = r.levels.length ? r.levels[r.levels.length - 1].position : undefined;
  const nearest = r.levels.find((l) => l.position === Math.round(r.score));
  return (
    r.score.toFixed(1) +
    (top !== undefined ? ` on a scale of 0 to ${top}` : "") +
    (nearest?.label ? `, nearest: ${nearest.label}` : "")
  );
}
