// A `decision` state's questions (loomcycle 1.109, RFC ED): typed questions a
// decision model answers with probabilities and no text.
//
//   choice   pick one option        criteria: {option: description | null}
//   noul     yes or no              criteria: optional {"true"?: …, "false"?: …}
//   score    a place on a scale     criteria: [level descriptions, lowest first]
//
// `questionFaults` mirrors loomcycle's decisionq.Validate — the one validator
// the Decision tool and a team's save both use — and `routeAnswers` mirrors
// teamgraph.RouteAnswers: the answers a routed question can give, each of
// which takes the transition `conditional:<answer>`.
//
// Pure: no React, no network.

import type { Json, JsonObject } from "./model";

export const QUESTION_TYPES = ["choice", "noul", "score"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** What one model takes. `ANY_MODEL` is what can be checked with no model in
 *  hand — the least every decision model asks — and is what a team's save is
 *  held to; a model's own limits add how many questions and options it takes. */
export interface DecisionLimits {
  maxQuestions?: number;
  minOptions: number;
  maxOptions?: number;
}
export const ANY_MODEL: DecisionLimits = { minOptions: 2 };

export interface QuestionFault {
  /** The question at fault; absent for a fault in the set as a whole. */
  question?: string;
  message: string;
}

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CHOICE_SHAPE = "choice criteria must be an object mapping each option to a description or null";
const NOUL_SHAPE = 'noul criteria must be an object describing "true" and "false"';
const SCORE_SHAPE = "score criteria must be an array of descriptions, lowest level first";

function questionFault(name: string, q: Json | undefined, lim: DecisionLimits): string | undefined {
  if (name === "") return "a question needs a name";
  // Go decodes a question into {type, instructions string; criteria raw}: any
  // other shape fails the decode of the whole definition.
  if (!isObj(q)) return "must be an object of type, instructions and criteria";
  if (q.type !== undefined && typeof q.type !== "string") return "`type` must be a string";
  if (q.instructions !== undefined && typeof q.instructions !== "string") return "`instructions` must be a string";
  const type = typeof q.type === "string" ? q.type : "";
  if (!(typeof q.instructions === "string" && q.instructions.trim())) return "instructions are required";
  const criteria = q.criteria;
  const absent = criteria === undefined || criteria === null;
  const options = (n: number, what: string) => {
    if (n >= lim.minOptions && (!lim.maxOptions || n <= lim.maxOptions)) return undefined;
    const takes = lim.maxOptions ? `${lim.minOptions} to ${lim.maxOptions}` : `at least ${lim.minOptions}`;
    return `${n} ${what}; a ${type} takes ${takes}`;
  };
  switch (type) {
    case "choice": {
      if (absent || !isObj(criteria)) return CHOICE_SHAPE;
      for (const [key, v] of Object.entries(criteria)) {
        if (key === "" || !(typeof v === "string" || v === null)) return CHOICE_SHAPE;
      }
      return options(Object.keys(criteria).length, "options");
    }
    case "noul": {
      if (absent) return undefined;
      if (!isObj(criteria)) return NOUL_SHAPE;
      for (const [key, v] of Object.entries(criteria)) {
        if ((key !== "true" && key !== "false") || typeof v !== "string") return NOUL_SHAPE;
      }
      return undefined;
    }
    case "score": {
      if (absent || !Array.isArray(criteria)) return SCORE_SHAPE;
      if (criteria.some((v) => typeof v !== "string")) return SCORE_SHAPE;
      return options(criteria.length, "levels");
    }
    default:
      return `type ${JSON.stringify(type)} is not one of choice, noul, score`;
  }
}

/** Everything wrong with a set of questions, in name order, the set's own
 *  fault first. Empty when the set is well formed. */
export function questionFaults(questions: Json | undefined, lim: DecisionLimits = ANY_MODEL): QuestionFault[] {
  if (questions !== undefined && questions !== null && !isObj(questions)) {
    return [{ message: "`questions` must be an object of name to question" }];
  }
  const set = isObj(questions) ? questions : {};
  const names = Object.keys(set).sort();
  if (!names.length) return [{ message: "at least one question is required" }];
  const out: QuestionFault[] = [];
  if (lim.maxQuestions && names.length > lim.maxQuestions) {
    out.push({ message: `${names.length} questions; one call takes at most ${lim.maxQuestions}` });
  }
  for (const name of names) {
    const message = questionFault(name, set[name], lim);
    if (message) out.push({ question: name, message });
  }
  return out;
}

/** A choice question's options, sorted; undefined for another type or
 *  criteria that are not a choice's. */
export function choiceOptions(q: Json | undefined): string[] | undefined {
  if (!isObj(q) || q.type !== "choice" || !isObj(q.criteria)) return undefined;
  return Object.keys(q.criteria).sort();
}

/** Every answer a decision handler's routed question can give, sorted — or
 *  undefined when it routes on nothing it can: no `route`, one naming no
 *  question, or a question that is neither a choice nor a yes/no. */
export function routeAnswers(handler: JsonObject): string[] | undefined {
  const route = typeof handler.route === "string" ? handler.route : "";
  const questions = isObj(handler.questions) ? handler.questions : {};
  if (!route || !(route in questions)) return undefined;
  const q = questions[route];
  if (isObj(q) && q.type === "noul") return ["false", "true"];
  const opts = choiceOptions(q);
  return opts && opts.length ? opts : undefined;
}

/** The transition label a routed answer takes. */
export function routeEdge(answer: string): string {
  return `conditional:${answer}`;
}

/** The label a NEW transition out of a decision state takes, given the labels
 *  it already has: the first routed answer with no edge of its own, then
 *  `success` (which takes every answer without one), then nothing — every
 *  answer is spoken for, and a decision state takes no other label. */
export function nextDecisionEdge(handler: JsonObject, used: ReadonlySet<string>): string | undefined {
  for (const a of routeAnswers(handler) ?? []) {
    if (!used.has(routeEdge(a))) return routeEdge(a);
  }
  return used.has("success") ? undefined : "success";
}

