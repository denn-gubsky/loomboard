import { describe, expect, it } from "vitest";
import { addLocal, defaultLocalBody, localBodyFindings, localNameError, removeLocal, setLocal } from "./localEdit";
import { fromDefinition, toDefinition } from "./model";
import { localNames } from "./teamLocal";
import { canSave, validateModel } from "./validate";

const base = (local?: Record<string, unknown>) =>
  fromDefinition({
    entry: "w",
    states: [
      { state: "w", handler: { kind: "agent", agent: "./writer" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "w", to: "done", on: "success" }],
    ...(local ? { local } : {}),
  });

describe("editing a team's own definitions", () => {
  it("adds an entry with a body the runtime accepts, and refuses a bad or taken name", () => {
    const m = addLocal(base(), "agents", "writer");
    expect(localNames(m, "agents")).toEqual(["writer"]);
    expect(toDefinition(m).local).toEqual({ agents: { writer: {} } });
    expect(localNameError(m, "agents", "writer")).toMatch(/already declares/);
    expect(localNameError(m, "agents", "my writer")).toMatch(/one segment/);
    expect(addLocal(m, "agents", "my writer")).toBe(m);
  });

  it("starts a schedule or webhook on the team's first own channel", () => {
    const m = addLocal(base(), "channels", "inbox");
    expect(defaultLocalBody(m, "schedules")).toEqual({ schedule: "@hourly", channel: "./inbox" });
    expect(defaultLocalBody(m, "webhooks")).toEqual({ auth: { kind: "hmac", signing_secret_env: "" }, channel: "./inbox" });
  });

  it("changes and removes an entry, leaving the other kinds and entries alone", () => {
    const saved = base({ agents: { writer: { tier: "low" } }, channels: { inbox: { scope: "tenant" } } });
    const m = setLocal(saved, "agents", "writer", { tier: "high", system_prompt: "Write." });
    expect(toDefinition(m).local).toEqual({
      agents: { writer: { tier: "high", system_prompt: "Write." } },
      channels: { inbox: { scope: "tenant" } },
    });
    expect(setLocal(saved, "agents", "nobody", {})).toBe(saved);
    const gone = removeLocal(saved, "channels", "inbox");
    expect(toDefinition(gone).local).toEqual({ agents: { writer: { tier: "low" } }, channels: {} });
  });

  it("writes an emptied kind as {} — a fork keeps every kind its overlay omits — and adds none it never had", () => {
    const saved = base({ agents: { writer: {} } });
    expect(toDefinition(removeLocal(saved, "agents", "writer")).local).toEqual({ agents: {} });
    // Added then removed in one session: the kind was never saved, so no key.
    const none = removeLocal(addLocal(base(), "skills", "style"), "skills", "style");
    expect("local" in toDefinition(none)).toBe(false);
  });

  it("is checked as it stands: removing an agent a state runs is reported before the save", () => {
    const saved = base({ agents: { writer: {} } });
    expect(canSave(validateModel(saved))).toBe(true);
    const findings = validateModel(removeLocal(saved, "agents", "writer"));
    expect(canSave(findings)).toBe(false);
    expect(findings.map((f) => f.message).join("\n")).toMatch(/"\.\/writer" names a local agent the team does not declare/);
  });
});

describe("localBodyFindings — what the authoring call refuses about a body", () => {
  it("says what each new entry still needs, until it has it", () => {
    let m = base({ agents: { writer: {} } });
    for (const k of ["skills", "channels", "webhooks"] as const) m = addLocal(m, k, `x${k}`);
    const msgs = localBodyFindings(m).map((f) => f.message);
    expect(msgs).toEqual([
      'local.skills["xskills"]: body is required and must contain non-whitespace content',
      'local.webhooks["xwebhooks"]: auth.kind=hmac requires auth.signing_secret_env',
    ]);
    m = setLocal(m, "skills", "xskills", { body: "Write plainly." });
    m = setLocal(m, "webhooks", "xwebhooks", { auth: { kind: "bearer", bearer_token_env: "HOOK_TOKEN" }, channel: "./xchannels" });
    expect(localBodyFindings(m)).toEqual([]);
  });

  it("refuses a channel with no scope — the runtime has no default for one", () => {
    const m = base({ channels: { inbox: {} } });
    expect(localBodyFindings(m)[0].message).toMatch(/scope must be tenant .* or user/);
  });
});
