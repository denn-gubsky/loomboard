// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionQuestionsEditor, type DecisionQuestionsEditorProps } from "./DecisionQuestionsEditor";
import type { HandlerPatch } from "../lib/decision";
import type { JsonObject } from "../lib/model";

afterEach(cleanup);

const start: JsonObject = {
  kind: "decision",
  about: { ticket: "{{thread.output}}" },
  questions: {
    route: { type: "choice", instructions: "Which team?", criteria: { billing: "invoices", support: null } },
    urgent: { type: "noul", instructions: "Reply within the hour?" },
    detail: { type: "score", instructions: "How complete?", criteria: ["none", "all"] },
  },
  route: "route",
  capture: { team: "$.answers.route.choice" },
};

/** The editor over a handler that applies its patches, as the canvas does. */
function Harness(props: Partial<DecisionQuestionsEditorProps> & { initial?: JsonObject; seen?: (h: JsonObject) => void }) {
  const [handler, setHandler] = useState<JsonObject>(props.initial ?? start);
  const onPatch = (patch: HandlerPatch) => {
    const next: JsonObject = { ...handler };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    setHandler(next);
    props.seen?.(next);
  };
  return <DecisionQuestionsEditor {...props} handler={handler} onPatch={onPatch} />;
}

const q = (name: string) => within(screen.getByTestId(`question-${name}`));

describe("DecisionQuestionsEditor", () => {
  it("shows each question with its type, and says what is wrong with one", () => {
    render(<Harness initial={{ ...start, questions: { ...(start.questions as JsonObject), urgent: { type: "noul", instructions: "" } } }} />);
    expect((q("route").getByLabelText("Type of question route") as HTMLSelectElement).value).toBe("choice");
    expect((q("detail").getByLabelText("Level 1 of question detail") as HTMLInputElement).value).toBe("all");
    expect(q("urgent").getByText("instructions are required")).toBeTruthy();
  });

  it("writes the instructions as they are typed", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.change(q("urgent").getByLabelText("Instructions for question urgent"), { target: { value: "Is it on fire?" } });
    expect((seen.mock.lastCall![0].questions as Record<string, JsonObject>).urgent.instructions).toBe("Is it on fire?");
  });

  it("renames a question when the name is committed, and the route and captures follow", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    const name = q("route").getByLabelText("Name of question route");
    fireEvent.change(name, { target: { value: "team" } });
    // Not on each keystroke: that would rename the key under the input.
    expect(seen).not.toHaveBeenCalled();
    fireEvent.blur(name);
    const h = seen.mock.lastCall![0] as JsonObject;
    expect(Object.keys(h.questions as object)).toEqual(["team", "urgent", "detail"]);
    expect(h.route).toBe("team");
    expect(h.capture).toEqual({ team: "$.answers.team.choice" });
    expect(screen.getByTestId("question-team")).toBeTruthy();
  });

  it("renames an option of the routed question and asks for its transition to follow", () => {
    const seen = vi.fn();
    const onRenameAnswer = vi.fn();
    render(<Harness seen={seen} onRenameAnswer={onRenameAnswer} />);
    const opt = q("route").getByLabelText("Option 1 of question route");
    fireEvent.change(opt, { target: { value: "finance" } });
    fireEvent.blur(opt);
    expect(((seen.mock.lastCall![0].questions as Record<string, JsonObject>).route.criteria)).toEqual({ finance: "invoices", support: null });
    expect(onRenameAnswer).toHaveBeenCalledWith("billing", "finance");
  });

  it("does not rename an option onto another one", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    const opt = q("route").getByLabelText("Option 1 of question route");
    fireEvent.change(opt, { target: { value: "support" } });
    fireEvent.blur(opt);
    expect(seen).not.toHaveBeenCalled();
  });

  it("adds and removes options and levels", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.click(q("route").getByRole("button", { name: "Add option" }));
    expect(Object.keys((seen.mock.lastCall![0].questions as Record<string, JsonObject>).route.criteria as object)).toEqual(["billing", "support", "option"]);
    fireEvent.click(q("route").getByRole("button", { name: "Remove option billing" }));
    expect(Object.keys((seen.mock.lastCall![0].questions as Record<string, JsonObject>).route.criteria as object)).toEqual(["support", "option"]);
    fireEvent.click(q("detail").getByRole("button", { name: "Add level" }));
    expect((seen.mock.lastCall![0].questions as Record<string, JsonObject>).detail.criteria).toEqual(["none", "all", ""]);
  });

  it("routes on the question chosen, and offers the yes threshold only for a routed yes/no", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    expect(screen.queryByLabelText("Yes threshold")).toBeNull();
    // A score cannot route, so it is not offered.
    expect(q("detail").queryByRole("radio")).toBeNull();
    fireEvent.click(q("urgent").getByRole("radio"));
    expect(seen.mock.lastCall![0].route).toBe("urgent");
    fireEvent.change(screen.getByLabelText("Yes threshold"), { target: { value: "0.7" } });
    expect(seen.mock.lastCall![0].threshold).toBe(0.7);
    // Routing on the choice again drops the threshold with the yes/no route.
    fireEvent.click(q("route").getByRole("radio"));
    expect(seen.mock.lastCall![0]).toMatchObject({ route: "route" });
    expect("threshold" in seen.mock.lastCall![0]).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /no answer routes/ }));
    expect("route" in seen.mock.lastCall![0]).toBe(false);
  });

  it("says where each answer of the routed question goes, and which has nowhere to go", () => {
    render(<Harness edges={[{ on: "conditional:billing", to: "billing-desk" }]} />);
    const list = screen.getByRole("list", { name: "Where each answer of route goes" });
    expect(list.textContent).toMatch(/billing → billing-desk/);
    expect(list.textContent).toMatch(/support → no transition yet/);
  });

  it("counts a success transition as taking the answers without their own", () => {
    render(<Harness edges={[{ on: "conditional:billing", to: "billing-desk" }, { on: "success", to: "triage-2" }]} />);
    expect(screen.getByRole("list", { name: "Where each answer of route goes" }).textContent).toMatch(/support → triage-2 \(by its success transition\)/);
  });

  it("adds a question of the chosen type under a free name, and removes one", () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.change(screen.getByLabelText("Type of the new question"), { target: { value: "score" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect((seen.mock.lastCall![0].questions as Record<string, JsonObject>).question).toEqual({ type: "score", instructions: "", criteria: ["lowest", "highest"] });
    fireEvent.click(q("route").getByRole("button", { name: "Remove question" }));
    const h = seen.mock.lastCall![0] as JsonObject;
    expect(Object.keys(h.questions as object)).toEqual(["urgent", "detail", "question"]);
    // It was the routed one.
    expect("route" in h).toBe(false);
  });

  it("offers no routing where there is nothing to route — the lab", () => {
    render(<Harness routing={false} />);
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.queryByRole("list", { name: /Where each answer/ })).toBeNull();
  });
});
