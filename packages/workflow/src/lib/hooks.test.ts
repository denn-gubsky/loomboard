import { describe, expect, it } from "vitest";
import { fromDefinition } from "./model";
import { validateModel } from "./validate";
import { hasHooks, parseRef, validateEventHooks, validateStateHooks } from "./hooks";

// The VERDICTS are pinned by the shared fixtures (validate-cases.json, every
// one run through loomcycle's own decoder + Validate). These pin what the
// fixtures cannot: where a finding lands and what it says, since the canvas
// shows the message on the node.

const linear = (handler: Record<string, unknown>, walk?: Record<string, unknown>) =>
  fromDefinition({
    entry: "s",
    states: [
      { state: "s", handler },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "s", to: "done", on: "success" }],
    ...(walk ? { hooks: walk } : {}),
  });

describe("hook findings (RFC DK) — anchoring and wording", () => {
  it("anchors a state's hook finding to that state, named like the Go error", () => {
    const f = validateModel(
      linear({ kind: "vars", set: { d: "${run.date}" }, hooks: { agent_stop: ["cite-sources"] } }),
    ).find((x) => x.message.includes("hooks"));
    expect(f?.nodeId).toBe("s");
    expect(f?.message).toBe('state "s" (vars) starts no run, so it cannot carry hooks');
  });

  it("reports the walk's hooks at the team level, with no node to highlight", () => {
    const f = validateModel(
      linear({ kind: "agent", agent: "a" }, { agent_stop: ["cite-sources"] }),
    ).find((x) => x.message.includes("hooks"));
    expect(f?.nodeId).toBeUndefined();
    expect(f?.message).toMatch(/only run_end fires for it \(got agent_stop\)/);
  });

  it("names the event and the entry that is wrong", () => {
    expect(validateEventHooks({ pre: [{ name: "gate", url: "ftp://x" }] })).toBe(
      "hooks.pre: inline webhook gate: url must be http:// or https://",
    );
  });

  it("splits a reference on its LAST @, as hooks.ParseRef does", () => {
    // The verdict is the same either way for "a@b@2" — the fixtures cannot see
    // the difference — but the message tells the operator which half is wrong.
    expect(parseRef("cite@sources@2")).toMatch(/name "cite@sources" has invalid character "@"/);
  });

  it("counts EVENTS, not entries, when deciding whether hooks are present", () => {
    // Go's len(h.Hooks) — an event with an empty list is still an attachment.
    expect(hasHooks({ agent_stop: [] })).toBe(true);
    expect(hasHooks({})).toBe(false);
    expect(hasHooks(undefined)).toBe(false);
  });

  it("never echoes a header VALUE into a message — it may name a credential", () => {
    const msgs = validateStateHooks("agent", {
      kind: "agent",
      agent: "a",
      hooks: { pre: [{ name: "gate", url: "https://x", headers: { Host: "$cred:secret-key" } }] },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('header "Host" is set by the call itself');
    expect(msgs[0]).not.toContain("secret-key");
  });
});
