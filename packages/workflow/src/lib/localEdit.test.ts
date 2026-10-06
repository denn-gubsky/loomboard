import { describe, expect, it } from "vitest";
import { addLocal, defaultLocalBody, localBodyFindings, localNameError, removeLocal, renameLocal, setLocal } from "./localEdit";
import { forkOverlay } from "./fork";
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
    expect(toDefinition(gone).local).toEqual({ agents: { writer: { tier: "low" } } });
    expect(forkOverlay(toDefinition(saved), toDefinition(gone)).local).toEqual({ agents: { writer: { tier: "low" } }, channels: {} });
  });

  it("the save sends an emptied kind as {} — a fork keeps every kind its overlay omits — and adds none it never had", () => {
    const saved = base({ agents: { writer: {} } });
    const emptied = toDefinition(removeLocal(saved, "agents", "writer"));
    expect("local" in emptied).toBe(false);
    expect(forkOverlay(toDefinition(saved), emptied).local).toEqual({ agents: {} });
    // Added then removed in one session: the kind was never saved, so no key.
    const none = removeLocal(addLocal(base(), "skills", "style"), "skills", "style");
    expect("local" in forkOverlay(toDefinition(base()), toDefinition(none))).toBe(false);
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

describe("renameLocal — every ./name reference follows", () => {
  const team = () =>
    fromDefinition({
      entry: "form",
      states: [
        { state: "research", handler: { kind: "starter", source: { channel: "./inbox" }, fanout: { agent: "./writer", max: 1 }, sink: { channel: "./out" } } },
        { state: "edit", handler: { kind: "agent", agent: "./writer", input_template: "{{thread.output}}" } },
        { state: "form", handler: { kind: "input", publish: { channel: "./inbox" } } },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [
        { from: "form", to: "research", on: "success" },
        { from: "research", to: "edit", on: "success" },
        { from: "edit", to: "done", on: "success" },
      ],
      local: {
        agents: { writer: { skills: ["./style"], channels: { publish: ["./inbox"], subscribe: ["./out"] } } },
        skills: { style: { body: "Plain." } },
        channels: { inbox: { scope: "tenant" }, out: { scope: "tenant" } },
        schedules: { tick: { schedule: "@hourly", channel: "./inbox" } },
        webhooks: { hook: { auth: { kind: "none" }, channel: "./inbox" } },
      },
      layout: { nodes: { "channel:./inbox": { x: 11, y: 22 } } },
    });

  it("renames an agent and every state that runs it", () => {
    const d = toDefinition(renameLocal(team(), "agents", "writer", "author"));
    const states = d.states as { state: string; handler: Record<string, unknown> }[];
    expect((states[0].handler.fanout as { agent: string }).agent).toBe("./author");
    expect(states[1].handler.agent).toBe("./author");
    expect(Object.keys((d.local as { agents: object }).agents)).toEqual(["author"]);
  });

  it("renames a skill in every agent's grant", () => {
    const d = toDefinition(renameLocal(team(), "skills", "style", "house"));
    expect((d.local as { agents: { writer: { skills: string[] } } }).agents.writer.skills).toEqual(["./house"]);
  });

  it("renames a channel everywhere it is named, and its node keeps its place", () => {
    const m = renameLocal(team(), "channels", "inbox", "queue");
    const d = toDefinition(m);
    const states = d.states as { state: string; handler: Record<string, { channel?: string }> }[];
    expect(states[0].handler.source.channel).toBe("./queue");
    expect(states[2].handler.publish.channel).toBe("./queue");
    const local = d.local as Record<string, Record<string, Record<string, unknown>>>;
    expect(local.schedules.tick.channel).toBe("./queue");
    expect(local.webhooks.hook.channel).toBe("./queue");
    expect(local.agents.writer.channels).toEqual({ publish: ["./queue"], subscribe: ["./out"] });
    const nodes = (d.layout as { nodes: Record<string, unknown> }).nodes;
    expect(nodes["channel:./queue"]).toEqual({ x: 11, y: 22 });
    expect(nodes["channel:./inbox"]).toBeUndefined();
    // Nothing left dangling.
    expect(canSave(validateModel(m))).toBe(true);
  });

  it("refuses a taken or invalid name, and leaves the team as it was", () => {
    const m = team();
    expect(renameLocal(m, "channels", "inbox", "out")).toBe(m);
    expect(renameLocal(m, "channels", "inbox", "a b")).toBe(m);
  });
});
