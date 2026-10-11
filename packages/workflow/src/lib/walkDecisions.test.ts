import { describe, expect, it } from "vitest";
import { decisionFace, decisionsOf, foldDecision, readDecision } from "./walkDecisions";

const record = {
  state: "triage",
  visit: 2,
  edge: "conditional:billing",
  next: "billing-desk",
  answer: {
    model: "decide",
    served_model: "nimble",
    answers: {
      route: { type: "choice", choice: "billing", probabilities: { billing: 0.91, support: 0.09 } },
      urgent: { type: "noul", noul: 0.4 },
    },
    usage: { input_tokens: 120, output_tokens: 3 },
  },
};

describe("readDecision", () => {
  it("keeps a record's state, visit, transition and answer", () => {
    expect(readDecision(record)).toEqual(record);
  });

  it("refuses what is not a record, rather than keeping half of one", () => {
    expect(readDecision(undefined)).toBeUndefined();
    expect(readDecision({ ...record, state: "" })).toBeUndefined();
    expect(readDecision({ ...record, visit: "2" })).toBeUndefined();
    expect(readDecision({ ...record, next: undefined })).toBeUndefined();
  });

  it("reads a record whose answer is missing as one with no answers", () => {
    expect(readDecision({ ...record, answer: null })?.answer).toEqual({ answers: {} });
  });
});

describe("foldDecision", () => {
  const d = readDecision(record)!;

  it("keeps one record per visit, in visit order", () => {
    const later = { ...d, visit: 5, next: "support-desk" };
    expect(foldDecision(foldDecision([], later), d).map((x) => x.visit)).toEqual([2, 5]);
  });

  it("returns the same list for a visit it already holds, so a replay redraws nothing", () => {
    const list = foldDecision([], d);
    expect(foldDecision(list, { ...d })).toBe(list);
  });

  it("lists one state's visits latest first", () => {
    const list = [d, { ...d, state: "other", visit: 3 }, { ...d, visit: 5 }];
    expect(decisionsOf(list, "triage").map((x) => x.visit)).toEqual([5, 2]);
  });
});

describe("decisionFace", () => {
  const d = readDecision(record)!;

  it("says the option picked with its probability, and where the walk went", () => {
    expect(decisionFace(d, "route")).toBe("billing 91.0% → billing-desk");
  });

  it("says yes or no by the transition taken, with the model's probability of yes", () => {
    const no = { ...d, edge: "conditional:false", next: "calm" };
    expect(decisionFace(no, "urgent")).toBe("no (yes 40%) → calm");
  });

  it("falls back to the transition's answer when the routed question is not in the answer", () => {
    expect(decisionFace(d, "missing")).toBe("billing → billing-desk");
    expect(decisionFace({ ...d, edge: "success", next: "done" })).toBe("answered → done");
  });
});
