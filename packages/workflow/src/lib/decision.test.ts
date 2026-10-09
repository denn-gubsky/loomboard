import { describe, expect, it } from "vitest";
import { ANY_MODEL, choiceOptions, nextDecisionEdge, questionFaults, routeAnswers, routeEdge } from "./decision";

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

