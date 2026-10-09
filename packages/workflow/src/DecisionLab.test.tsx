// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionLab, type DecisionLabProps } from "./DecisionLab";
import type { DecisionCall, DecisionCallAnswer, DecisionModelInfo } from "./types";

afterEach(cleanup);

// The answer TrueNAS gave for a billing complaint (loomcycle 1.109.0).
const live: DecisionCallAnswer = {
  model: "decide",
  provider: "ollama-local",
  served_model: "nimble",
  answers: {
    route: { type: "choice", choice: "billing", probabilities: { billing: 0.9854, support: 0.0049 }, confidence: 0.92 },
  },
  usage: { input_tokens: 876, output_tokens: 4 },
};

const models: DecisionModelInfo[] = [
  { name: "decide", default: true, served: "nimble", limits: { maxQuestions: 64, minOptions: 2, maxOptions: 26 } },
  { name: "tiny", served: "small", limits: { maxQuestions: 1, minOptions: 2, maxOptions: 2 } },
];

function lab(o: Partial<DecisionLabProps> = {}) {
  const decide = vi.fn(async (_c: DecisionCall): Promise<DecisionCallAnswer> => live);
  const onClose = vi.fn();
  render(<DecisionLab decide={decide} listDecisionModels={async () => models} onClose={onClose} {...o} />);
  return { decide: (o.decide as typeof decide | undefined) ?? decide, onClose };
}

const ask = () => screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement;

describe("DecisionLab", () => {
  it("asks the model about the state with the questions, and shows what it answered", async () => {
    const { decide } = lab();
    fireEvent.click(ask());
    const row = await screen.findByTestId("answer-route");
    expect(row.textContent).toMatch(/→ billing/);
    expect(row.textContent).toMatch(/billing 98\.5%/);
    expect(row.textContent).toMatch(/support 0\.5%/);
    const call = decide.mock.calls[0][0];
    expect(call.state).toEqual({ ticket: "My invoice for March was charged twice and I want my money back." });
    expect(Object.keys(call.questions)).toEqual(["route"]);
    // No model named: the runtime's default answers.
    expect("model" in call).toBe(false);
    expect(screen.getByRole("region", { name: "Answer" }).textContent).toMatch(/decide \(nimble\) · 876 tokens in, 4 out/);
    expect(screen.getByText(/not calibrated/)).toBeTruthy();
  });

  it("names the model chosen, and says a call is real before one is made", async () => {
    const { decide } = lab();
    expect(screen.getByText(/Each Ask is a real call, charged to you/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("option", { name: "decide — nimble" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Decision model"), { target: { value: "decide" } });
    fireEvent.click(ask());
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0][0].model).toBe("decide");
  });

  it("does not ask while the state is not a JSON object, and says where it breaks", () => {
    const { decide } = lab();
    fireEvent.change(screen.getByLabelText("What the questions are about (JSON)"), { target: { value: '{\n  "ticket": \n}' } });
    expect(screen.getByText(/^Line 3, column \d+:/)).toBeTruthy();
    expect(ask().disabled).toBe(true);
    fireEvent.click(ask());
    expect(decide).not.toHaveBeenCalled();
  });

  it("holds the questions to the chosen model's own limits", async () => {
    lab({ seed: { questions: { r: { type: "choice", instructions: "x", criteria: { a: null, b: null, c: null } } } } });
    expect(ask().disabled).toBe(false);
    await waitFor(() => expect(screen.getByRole("option", { name: "tiny — small" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Decision model"), { target: { value: "tiny" } });
    expect(screen.getByText("3 options; a choice takes 2 to 2")).toBeTruthy();
    expect(ask().disabled).toBe(true);
  });

  it("shows the runtime's refusal in its own words, and no answer", async () => {
    lab({ decide: vi.fn(async () => Promise.reject(new Error('Decision: prompt_too_large: 9000 tokens; "nimble" takes 8194'))) });
    fireEvent.click(ask());
    expect((await screen.findByRole("alert")).textContent).toBe('Decision: prompt_too_large: 9000 tokens; "nimble" takes 8194');
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  });

  it("marks an answer as asked before the last edit", async () => {
    lab();
    fireEvent.click(ask());
    const answer = await screen.findByRole("region", { name: "Answer" });
    expect(within(answer).queryByText(/Asked before the last edit/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Instructions for question route"), { target: { value: "Who takes it?" } });
    expect(within(answer).getByText(/Asked before the last edit/)).toBeTruthy();
  });

  it("starts from a Decision node's questions and about, and writes its questions back on request", async () => {
    const onApply = vi.fn();
    lab({
      seed: {
        nodeId: "triage",
        questions: { urgent: { type: "noul", instructions: "Reply within the hour?" } },
        about: { ticket: "{{thread.output}}" },
      },
      onApply,
    });
    // The node's placeholder is literal text here, for the operator to replace.
    expect((screen.getByLabelText("What the questions are about (JSON)") as HTMLTextAreaElement).value).toContain("{{thread.output}}");
    fireEvent.change(screen.getByLabelText("Instructions for question urgent"), { target: { value: "Is it on fire?" } });
    fireEvent.click(screen.getByRole("button", { name: "Use on triage" }));
    expect(onApply).toHaveBeenCalledWith({ urgent: { type: "noul", instructions: "Is it on fire?" } });
  });

  it("offers no routing — it asks, it does not route — and closes", () => {
    const { onClose } = lab();
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Use on/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
