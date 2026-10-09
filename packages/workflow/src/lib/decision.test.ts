import { describe, expect, it } from "vitest";
import {
  addQuestion,
  ANY_MODEL,
  canRoute,
  choiceOptions,
  decisionTaken,
  freeName,
  levelsOf,
  newQuestion,
  nextDecisionEdge,
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
} from "./decision";

const choice = { type: "choice", instructions: "Which team?", criteria: { billing: "invoices", support: null } };
const noul = { type: "noul", instructions: "Is it urgent?" };
const score = { type: "score", instructions: "How complete?", criteria: ["none", "some", "all"] };

describe("questionFaults — what loomcycle's decisionq.Validate refuses", () => {
  it("accepts one of each type", () => {
    expect(questionFaults({ route: choice, urgent: noul, detail: score })).toEqual([]);
  });

  it("needs at least one question, and an object of them", () => {
    expect(questionFaults({})).toEqual([{ message: "at least one question is required" }]);
    expect(questionFaults(undefined)).toEqual([{ message: "at least one question is required" }]);
    expect(questionFaults([noul])).toEqual([{ message: "`questions` must be an object of name to question" }]);
  });

  it("reports each bad question by name, in name order", () => {
    expect(
      questionFaults({
        z: { type: "noul", instructions: " " },
        a: { type: "maybe", instructions: "x" },
        m: { type: "choice", instructions: "x", criteria: { only: "one" } },
      }),
    ).toEqual([
      { question: "a", message: 'type "maybe" is not one of choice, noul, score' },
      { question: "m", message: "1 options; a choice takes at least 2" },
      { question: "z", message: "instructions are required" },
    ]);
  });

  it("holds each type's criteria to its shape", () => {
    const fault = (q: unknown) => questionFaults({ q } as never)[0]?.message;
    expect(fault({ type: "choice", instructions: "x" })).toMatch(/choice criteria must be an object/);
    expect(fault({ type: "choice", instructions: "x", criteria: { a: 1, b: "y" } })).toMatch(/choice criteria/);
    expect(fault({ type: "noul", instructions: "x", criteria: { maybe: "x" } })).toMatch(/noul criteria/);
    expect(fault({ type: "noul", instructions: "x", criteria: { true: "now" } })).toBeUndefined();
    expect(fault({ type: "score", instructions: "x", criteria: ["only"] })).toBe("1 levels; a score takes at least 2");
    expect(fault({ type: "score", instructions: "x", criteria: { 0: "a" } })).toMatch(/score criteria must be an array/);
  });

  it("applies a model's own limits when given them", () => {
    const lim = { maxQuestions: 1, minOptions: 2, maxOptions: 2 };
    expect(questionFaults({ a: noul, b: noul }, lim)[0]).toEqual({ message: "2 questions; one call takes at most 1" });
    expect(questionFaults({ s: score }, lim)).toEqual([{ question: "s", message: "3 levels; a score takes 2 to 2" }]);
    expect(ANY_MODEL).toEqual({ minOptions: 2 });
  });
});

describe("routeAnswers — what a routed question can answer", () => {
  it("gives a choice's options, sorted, and true/false for a yes/no", () => {
    expect(routeAnswers({ questions: { route: choice }, route: "route" })).toEqual(["billing", "support"]);
    expect(routeAnswers({ questions: { u: noul }, route: "u" })).toEqual(["false", "true"]);
    expect(choiceOptions(choice)).toEqual(["billing", "support"]);
  });

  it("gives nothing when the state routes on nothing it can", () => {
    expect(routeAnswers({ questions: { u: noul } })).toBeUndefined();
    expect(routeAnswers({ questions: { u: noul }, route: "other" })).toBeUndefined();
    expect(routeAnswers({ questions: { s: score }, route: "s" })).toBeUndefined();
    expect(routeAnswers({ questions: { c: { type: "choice", instructions: "x", criteria: {} } }, route: "c" })).toBeUndefined();
  });

  it("names the transition an answer takes", () => {
    expect(routeEdge("billing")).toBe("conditional:billing");
  });
});

describe("nextDecisionEdge — the label a new transition out of a decision takes", () => {
  const h = { questions: { route: choice }, route: "route" };

  it("takes each answer that has no edge yet, in order, then success, then nothing", () => {
    const used = new Set<string>();
    const taken: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const next = nextDecisionEdge(h, used);
      taken.push(next);
      if (next) used.add(next);
    }
    expect(taken).toEqual(["conditional:billing", "conditional:support", "success", undefined]);
  });

  it("is success, once, for a decision that routes on nothing", () => {
    expect(nextDecisionEdge({ questions: { u: noul } }, new Set())).toBe("success");
    expect(nextDecisionEdge({ questions: { u: noul } }, new Set(["success"]))).toBeUndefined();
  });
});

describe("editing a decision's questions — each edit is a patch that keeps what points at the question", () => {
  const handler = {
    kind: "decision",
    about: { t: "{{thread.output}}" },
    questions: { route: choice, urgent: noul, detail: score },
    route: "route",
    capture: { team: "$.answers.route.choice", sure: "$.answers.route.probabilities.billing", u: "$.answers.urgent.noul", other: "$.model" },
  };

  it("lists the questions in the order they are written", () => {
    expect(questionsOf(handler).map(([n]) => n)).toEqual(["route", "urgent", "detail"]);
  });

  it("adds a question that is already well formed for its type, and refuses a taken or empty name", () => {
    const patch = addQuestion(handler, "tone", "choice");
    expect(Object.keys(patch.questions as object)).toEqual(["route", "urgent", "detail", "tone"]);
    expect(questionFaults({ a: { ...newQuestion("choice"), instructions: "x" }, b: { ...newQuestion("score"), instructions: "x" }, c: { ...newQuestion("noul"), instructions: "x" } })).toEqual([]);
    expect(addQuestion(handler, "route", "noul")).toEqual({});
    expect(addQuestion(handler, "", "noul")).toEqual({});
    expect(freeName("question", ["question", "question-2"])).toBe("question-3");
  });

  it("renames a question in place, and moves the route and the captures that read its answer", () => {
    const patch = renameQuestion(handler, "route", "team");
    expect(Object.keys(patch.questions as object)).toEqual(["team", "urgent", "detail"]);
    expect(patch.route).toBe("team");
    expect(patch.capture).toEqual({ team: "$.answers.team.choice", sure: "$.answers.team.probabilities.billing", u: "$.answers.urgent.noul", other: "$.model" });
  });

  it("does not touch a capture of a question whose name only starts the same", () => {
    const h = { ...handler, questions: { r: noul, route: choice }, capture: { a: "$.answers.route.choice" }, route: "route" };
    expect(renameQuestion(h, "r", "ready").capture).toBeUndefined();
  });

  it("refuses a rename onto another question, or to nothing", () => {
    expect(renameQuestion(handler, "route", "urgent")).toEqual({});
    expect(renameQuestion(handler, "route", "")).toEqual({});
    expect(renameQuestion(handler, "nope", "x")).toEqual({});
  });

  it("removing the routed question leaves the state routing on nothing", () => {
    const patch = removeQuestion({ ...handler, route: "urgent", threshold: 0.7 }, "urgent");
    expect(Object.keys(patch.questions as object)).toEqual(["route", "detail"]);
    expect(patch).toMatchObject({ route: undefined, threshold: undefined });
    expect("route" in patch && "threshold" in patch).toBe(true);
    expect("route" in removeQuestion(handler, "detail")).toBe(false);
  });

  it("routes on a question or on nothing, and a threshold goes with a yes/no route only", () => {
    expect(setRoute({ ...handler, route: "urgent", threshold: 0.7 }, "route")).toEqual({ route: "route", threshold: undefined });
    expect(setRoute({ ...handler, threshold: 0.7 }, "urgent")).toEqual({ route: "urgent" });
    expect(setRoute(handler, undefined)).toEqual({ route: undefined });
    expect([choice, noul, score].map(canRoute)).toEqual([true, true, false]);
  });

  it("retypes a question: instructions kept, criteria replaced, and a route it can no longer serve dropped", () => {
    const toScore = retypeQuestion(handler, "route", "score");
    expect((toScore.questions as Record<string, unknown>).route).toEqual({ type: "score", instructions: "Which team?", criteria: ["lowest", "highest"] });
    expect(toScore).toMatchObject({ route: undefined, threshold: undefined });
    const toChoice = retypeQuestion({ ...handler, route: "urgent", threshold: 0.7 }, "urgent", "choice");
    expect(toChoice.threshold).toBeUndefined();
    expect("route" in toChoice).toBe(false);
    expect(retypeQuestion(handler, "urgent", "noul")).toEqual({});
  });

  it("replaces one question in place and leaves the rest as written", () => {
    const patch = setQuestion(handler, "urgent", { type: "noul", instructions: "Now?", extra: 1 });
    expect(Object.keys(patch.questions as object)).toEqual(["route", "urgent", "detail"]);
    expect((patch.questions as Record<string, unknown>).urgent).toEqual({ type: "noul", instructions: "Now?", extra: 1 });
  });

  it("reads and writes a choice's options, a score's levels and a yes/no's two sides", () => {
    expect(optionsOf(choice)).toEqual([
      ["billing", "invoices"],
      ["support", ""],
    ]);
    expect(withOptions(choice, [["billing", ""], ["sales", "quotes"]]).criteria).toEqual({ billing: null, sales: "quotes" });
    expect(levelsOf(score)).toEqual(["none", "some", "all"]);
    expect(withSide(noul, "true", "needs a reply now").criteria).toEqual({ true: "needs a reply now" });
    expect("criteria" in withSide(withSide(noul, "true", "x"), "true", "")).toBe(false);
  });
});

describe("decisionTaken — which way a walk went from a decision, told from where it has been", () => {
  const edges = [
    { on: "conditional:billing", to: "billing-desk" },
    { on: "conditional:support", to: "support-desk" },
    { on: "success", to: "catch-all" },
  ];

  it("names the answer when exactly one of its transitions leads somewhere the walk reached", () => {
    expect(decisionTaken(edges, new Set(["billing-desk"]))).toEqual({ on: "conditional:billing", to: "billing-desk", answer: "billing" });
  });

  it("names no answer for the success fallback: it took whichever answers have no edge of their own", () => {
    expect(decisionTaken(edges, new Set(["catch-all"]))).toEqual({ on: "success", to: "catch-all" });
  });

  it("says nothing when the walk reached none of them, or more than one", () => {
    expect(decisionTaken(edges, new Set(["elsewhere"]))).toBeUndefined();
    expect(decisionTaken(edges, new Set(["billing-desk", "support-desk"]))).toBeUndefined();
    expect(decisionTaken([], new Set(["x"]))).toBeUndefined();
  });
});

