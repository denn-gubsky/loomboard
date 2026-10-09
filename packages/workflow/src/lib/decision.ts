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

// ---- editing a decision handler's questions ----
//
// Each returns a PATCH for the handler (`undefined` removes a key), so the
// questions stay the definition's own JSON and whatever an edit does not own
// — a field a newer runtime added to a question, the author's key order —
// survives it.

export type HandlerPatch = Record<string, Json | undefined>;

function questionMap(handler: JsonObject): JsonObject {
  return isObj(handler.questions) ? handler.questions : {};
}

/** The handler's questions in the order they are written. */
export function questionsOf(handler: JsonObject): [string, JsonObject][] {
  return Object.entries(questionMap(handler)).map(([name, q]) => [name, isObj(q) ? q : {}]);
}

/** A well-formed start for a question of `type`. A choice needs two options
 *  and a score two levels, so each starts with two obvious placeholders. */
export function newQuestion(type: QuestionType): JsonObject {
  switch (type) {
    case "choice":
      return { type, instructions: "", criteria: { "option-1": null, "option-2": null } };
    case "score":
      return { type, instructions: "", criteria: ["lowest", "highest"] };
    default:
      return { type, instructions: "" };
  }
}

/** The first of `base`, `base-2`, `base-3`… that `taken` does not hold. */
export function freeName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export function addQuestion(handler: JsonObject, name: string, type: QuestionType): HandlerPatch {
  const questions = questionMap(handler);
  if (!name || name in questions) return {};
  return { questions: { ...questions, [name]: newQuestion(type) } };
}

/** Replace one question, in place. */
export function setQuestion(handler: JsonObject, name: string, q: JsonObject): HandlerPatch {
  const questions = questionMap(handler);
  if (!(name in questions)) return {};
  return { questions: Object.fromEntries(Object.entries(questions).map(([k, v]) => [k, k === name ? q : v])) };
}

/** A question of another type: its instructions kept, its criteria replaced
 *  by that type's start, since one type's criteria are never another's. When
 *  it was the routed question and can no longer route, the route goes too. */
export function retypeQuestion(handler: JsonObject, name: string, type: QuestionType): HandlerPatch {
  const cur = questionMap(handler)[name];
  if (!isObj(cur) || cur.type === type) return {};
  const { criteria: _c, ...rest } = cur;
  const next: JsonObject = { ...rest, ...newQuestion(type), instructions: typeof cur.instructions === "string" ? cur.instructions : "" };
  const patch = setQuestion(handler, name, next);
  if (handler.route === name) {
    if (type === "score") Object.assign(patch, { route: undefined, threshold: undefined });
    else if (type !== "noul") patch.threshold = undefined;
  }
  return patch;
}

// `$.answers.<name>` and whatever follows it, as a capture path names a
// question's answer.
function repoint(path: Json | undefined, from: string, to: string): Json | undefined {
  if (typeof path !== "string") return path;
  const prefix = `$.answers.${from}`;
  if (path !== prefix && !path.startsWith(`${prefix}.`) && !path.startsWith(`${prefix}[`)) return path;
  return `$.answers.${to}${path.slice(prefix.length)}`;
}

/** Rename a question, keeping its place — and keeping what points at it: the
 *  `route`, and every `capture` path into its answer. */
export function renameQuestion(handler: JsonObject, from: string, to: string): HandlerPatch {
  const questions = questionMap(handler);
  if (!to || from === to || !(from in questions) || to in questions) return {};
  const patch: HandlerPatch = {
    questions: Object.fromEntries(Object.entries(questions).map(([k, v]) => [k === from ? to : k, v])),
  };
  if (handler.route === from) patch.route = to;
  if (isObj(handler.capture)) {
    const capture = Object.fromEntries(Object.entries(handler.capture).map(([k, v]) => [k, repoint(v, from, to) as Json]));
    if (JSON.stringify(capture) !== JSON.stringify(handler.capture)) patch.capture = capture;
  }
  return patch;
}

/** Remove a question. If it routed the state, the state routes on nothing. */
export function removeQuestion(handler: JsonObject, name: string): HandlerPatch {
  const questions = questionMap(handler);
  if (!(name in questions)) return {};
  const patch: HandlerPatch = { questions: Object.fromEntries(Object.entries(questions).filter(([k]) => k !== name)) };
  if (handler.route === name) Object.assign(patch, { route: undefined, threshold: undefined });
  return patch;
}

/** Route on `name`, or on nothing. A threshold belongs to a routed yes/no
 *  question and is dropped with it. */
export function setRoute(handler: JsonObject, name: string | undefined): HandlerPatch {
  const q = name === undefined ? undefined : questionMap(handler)[name];
  const patch: HandlerPatch = { route: name };
  if (!(isObj(q) && q.type === "noul") && handler.threshold !== undefined) patch.threshold = undefined;
  return patch;
}

/** A question that may route: a choice or a yes/no. */
export function canRoute(q: JsonObject): boolean {
  return q.type === "choice" || q.type === "noul";
}

/** A choice's options in the order written, each with its description
 *  ("" for an option that explains itself). */
export function optionsOf(q: JsonObject): [string, string][] {
  return isObj(q.criteria) ? Object.entries(q.criteria).map(([k, v]) => [k, typeof v === "string" ? v : ""]) : [];
}

/** A choice with its options replaced. An empty description is written as
 *  null: the option explains itself. */
export function withOptions(q: JsonObject, options: readonly (readonly [string, string])[]): JsonObject {
  return { ...q, criteria: Object.fromEntries(options.map(([k, d]) => [k, d === "" ? null : d])) };
}

/** A score's levels, lowest first. */
export function levelsOf(q: JsonObject): string[] {
  return Array.isArray(q.criteria) ? q.criteria.map((v) => (typeof v === "string" ? v : "")) : [];
}

/** A yes/no question with one side's description set, or cleared when empty.
 *  With neither side described there are no criteria at all. */
export function withSide(q: JsonObject, side: "true" | "false", text: string): JsonObject {
  const cur = isObj(q.criteria) ? { ...q.criteria } : {};
  if (text) cur[side] = text;
  else delete cur[side];
  const { criteria: _c, ...rest } = q;
  return Object.keys(cur).length ? { ...rest, criteria: cur } : rest;
}

