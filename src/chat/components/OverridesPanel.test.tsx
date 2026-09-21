// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OverridesPanel from "./OverridesPanel";
import type { ConversationOverrides } from "../types";

afterEach(cleanup);

function panel(config: ConversationOverrides, extra: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(<OverridesPanel config={config} onChange={onChange} {...extra} />);
  return onChange;
}

/** The control def-fields renders for an override, found by its KEY.
 *
 *  Keyed on the `lc-df-key` code element rather than the visible label because
 *  def-fields does not associate its <label> with the control (no `for`, no id),
 *  so getByLabelText cannot reach it. Selecting by key is the better anchor
 *  anyway: the key is the thing that travels to the wire, the label is display. */
/** The "clear" button def-fields renders on a row whose value is set. */
function clearFor(key: string): HTMLElement {
  const code = [...document.querySelectorAll("code.lc-df-key")].find(
    (c) => c.textContent === key,
  );
  const btn = code?.closest(".lc-df-row")?.querySelector("button.lc-df-reset");
  if (!btn) throw new Error(`no clear affordance for ${key}`);
  return btn as HTMLElement;
}

function control(key: string): HTMLElement {
  const code = [...document.querySelectorAll("code.lc-df-key")].find(
    (c) => c.textContent === key,
  );
  if (!code) throw new Error(`no field row for ${key}`);
  const el = code.closest(".lc-df-row")?.querySelector("input, select, textarea");
  if (!el) throw new Error(`row for ${key} has no control`);
  return el as HTMLElement;
}

describe("OverridesPanel", () => {
  it("emits an overlay carrying the edited key", () => {
    const onChange = panel({});
    fireEvent.change(control("model"), { target: { value: "gemma4:latest" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemma4:latest" }),
    );
  });

  // THE LOAD-BEARING CONTRACT at the component boundary: the explicit "clear"
  // affordance DELETES the key rather than writing an empty value, which is what
  // keeps "inherit the agent" distinct from "set to nothing".
  it("the clear affordance emits an overlay WITHOUT the key", () => {
    const onChange = panel({ model: "gemma4:latest" });
    fireEvent.click(clearFor("model"));
    const next = onChange.mock.calls.at(-1)![0] as ConversationOverrides;
    expect("model" in next).toBe(false);
  });

  // The OTHER way to unset: emptying the text box. def-fields emits "" here
  // rather than dropping the key, so "" has to keep meaning inherit everywhere
  // downstream — which is why the mapper and configIsCustom both treat it so.
  it("emptying a text field yields a value that still means inherit", () => {
    const onChange = panel({ model: "gemma4:latest" });
    fireEvent.change(control("model"), { target: { value: "" } });
    const next = onChange.mock.calls.at(-1)![0] as ConversationOverrides;
    expect(next.model === undefined || next.model === "").toBe(true);
  });

  it("keeps a meaningful zero rather than treating it as cleared", () => {
    // Seeded rather than typed from nothing: retry_attempts is an `advanced`
    // field, which def-fields folds away until the overlay actually sets it.
    const onChange = panel({ retry_attempts: 3 });
    fireEvent.change(control("retry_attempts"), { target: { value: "0" } });
    const next = onChange.mock.calls.at(-1)![0] as ConversationOverrides;
    expect(next.retry_attempts).toBe(0);
    expect("retry_attempts" in next).toBe(true);
  });

  it("shows the legacy-fork note only for a chat still bound to a forked def", () => {
    panel({}, { legacyFork: "chat/medium__lb-1a2b3c4d" });
    expect(screen.getByText(/private agent copy/i)).toBeTruthy();
    expect(screen.getByText("chat/medium__lb-1a2b3c4d")).toBeTruthy();
    cleanup();
    panel({});
    expect(screen.queryByText(/private agent copy/i)).toBeNull();
  });

  // interruption is the only object-valued override, so it is the only field
  // that renders NESTED rows rather than a single control. It is also the one
  // that lets a chat ask questions on an agent whose definition leaves them off
  // — the capability the deleted AgentDef fork used to force on.
  it("renders the interruption ACL as nested rows", () => {
    panel({ interruption: { enabled: true } });
    const keys = [...document.querySelectorAll("code.lc-df-key")].map((c) => c.textContent);
    expect(keys).toContain("interruption");
    expect(keys).toContain("enabled");
  });

  it("emits the ACL as an object, not a flattened key", () => {
    const onChange = panel({ interruption: { enabled: false } });
    const row = [...document.querySelectorAll("code.lc-df-key")]
      .find((c) => c.textContent === "enabled")!
      .closest(".lc-df-row")!;
    fireEvent.click(row.querySelector("input[type=checkbox]")!);
    const next = onChange.mock.calls.at(-1)![0] as ConversationOverrides;
    expect(next.interruption).toEqual({ enabled: true });
  });

  it("renders the two lifetimes as separate groups", () => {
    panel({});
    expect(screen.getByText("This chat")).toBeTruthy();
    expect(screen.getByText("Next run only")).toBeTruthy();
  });
});

describe("OverridesPanel — inert advisories (RFC B B6)", () => {
  const inert = [
    {
      setting: "compaction.autocompact_at_pct",
      reason:
        'context.mode is "auto", and the compaction threshold is only consulted in append mode',
      fix: "context.autorecap_at_pct",
    },
  ];

  // The question this answers is a real one an operator asked after watching a
  // chat climb to 90%: "autocompaction did not start". The runtime knew why and
  // said so on effective-config; the panel was dropping it.
  it("names the dead setting, the reason and the live knob", () => {
    render(<OverridesPanel config={{}} inert={inert} onChange={() => undefined} />);
    expect(screen.getByText(/cannot take effect/i)).toBeTruthy();
    expect(screen.getByText("compaction.autocompact_at_pct")).toBeTruthy();
    expect(screen.getByText(/only consulted in append mode/)).toBeTruthy();
    expect(screen.getByText("context.autorecap_at_pct")).toBeTruthy();
  });

  it("says nothing when nothing is inert", () => {
    const { container } = render(
      <OverridesPanel config={{}} inert={[]} onChange={() => undefined} />,
    );
    expect(container.textContent).not.toMatch(/cannot take effect/i);
  });

  it("says nothing when the runtime is too old to report it", () => {
    const { container } = render(<OverridesPanel config={{}} onChange={() => undefined} />);
    expect(container.textContent).not.toMatch(/cannot take effect/i);
  });

  it("counts correctly when more than one setting is dead", () => {
    render(
      <OverridesPanel
        config={{}}
        inert={[...inert, { setting: "compaction.memory_flush", reason: "banks only when set" }]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/2 settings on this run cannot take effect/)).toBeTruthy();
  });
});
