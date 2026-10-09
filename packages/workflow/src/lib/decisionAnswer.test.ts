import { describe, expect, it } from "vitest";
import { answerRows, percent, scoreText } from "./decisionAnswer";

// The answer TrueNAS gave (loomcycle 1.109.0, model `decide` → nimble) for a
// billing complaint, on 2026-10-09.
const live = {
  model: "decide",
  provider: "ollama-local",
  served_model: "nimble",
  answers: {
    detail: {
      type: "score",
      score: 1.8079236559529366,
      legend: { "0": "no detail", "1": "some detail", "2": "everything needed" },
      probabilities: { "0": 0.06431559029845839, "1": 0.06344516345014656, "2": 0.872239246251395 },
      confidence: 0.5715852070253584,
    },
    route: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.9854374792880354, support: 0.004931214356933959, sales: 0.009631306355030431 },
      confidence: 0.9222955766588619,
    },
    urgent: { type: "noul", noul: 0.4086306795391058 },
  },
  usage: { input_tokens: 876, output_tokens: 4 },
};

describe("answerRows — a decision model's answer, as rows to show", () => {
  it("gives one row per question, in name order", () => {
    expect(answerRows(live).map((r) => `${r.question}:${r.type}`)).toEqual(["detail:score", "route:choice", "urgent:noul"]);
  });

  it("lists a choice's options most probable first, with the one picked", () => {
    const r = answerRows(live)[1];
    expect(r).toMatchObject({ type: "choice", choice: "billing", confidence: 0.9222955766588619 });
    expect(r.type === "choice" && r.options.map((o) => o.name)).toEqual(["billing", "sales", "support"]);
  });

  it("lists a score's levels lowest first, with their descriptions", () => {
    const r = answerRows(live)[0];
    expect(r.type === "score" && r.levels.map((l) => `${l.position} ${l.label}`)).toEqual(["0 no detail", "1 some detail", "2 everything needed"]);
    expect(r.type === "score" && scoreText(r)).toBe("1.8 on a scale of 0 to 2, nearest: everything needed");
  });

  it("keeps a yes/no of 0 as a definite no, not a missing answer", () => {
    expect(answerRows({ answers: { u: { type: "noul", noul: 0 } } })).toEqual([{ type: "noul", question: "u", yes: 0 }]);
  });

  it("shows an answer it does not recognise as it came, and never drops one", () => {
    const odd = { type: "ranking", order: ["a", "b"] };
    expect(answerRows({ answers: { r: odd, broken: "text", c: { type: "choice" } } })).toEqual([
      { type: "unknown", question: "broken", raw: "text" },
      { type: "unknown", question: "c", raw: { type: "choice" } },
      { type: "unknown", question: "r", raw: odd },
    ]);
  });

  it("ignores a probability that is not a number, rather than failing the whole answer", () => {
    const r = answerRows({ answers: { c: { type: "choice", choice: "a", probabilities: { a: 0.9, b: "high" } } } })[0];
    expect(r.type === "choice" && r.options).toEqual([{ name: "a", probability: 0.9 }]);
  });
});

describe("percent", () => {
  it("keeps a decimal where it matters — near 0 and near 100", () => {
    expect(percent(0.9854374792880354)).toBe("98.5%");
    expect(percent(0.004931214356933959)).toBe("0.5%");
    expect(percent(0.4086306795391058)).toBe("41%");
    expect(percent(0)).toBe("0.0%");
    expect(percent(1.2)).toBe("100.0%");
  });
});
