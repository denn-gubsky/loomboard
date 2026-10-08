import { describe, expect, it } from "vitest";
import { fromDefinition } from "./model";
import { TEAM_TEMPLATES, exportFileName, importDefinition, importNotes, teamNameError } from "./newTeam";
import { canSave, validateModel } from "./validate";

describe("TEAM_TEMPLATES", () => {
  it("gives a one-agent team whose only problem is the agent still to choose", () => {
    const t = TEAM_TEMPLATES.find((x) => x.id === "one-agent")!;
    const errors = validateModel(fromDefinition(t.definition)).filter((f) => f.level === "error");
    expect(errors.map((f) => f.nodeId)).toEqual(["work"]);
  });

  it("gives an empty team that cannot be saved until it has a state", () => {
    const t = TEAM_TEMPLATES.find((x) => x.id === "empty")!;
    const model = fromDefinition(t.definition);
    expect(model.nodes).toEqual([]);
    expect(canSave(validateModel(model))).toBe(false);
  });
});

describe("teamNameError", () => {
  it("accepts a one-segment name the runtime does not have yet", () => {
    expect(teamNameError("blog-team_2", ["marketing"])).toBeUndefined();
    expect(teamNameError("a".repeat(64), [])).toBeUndefined();
  });

  it("refuses an empty name, one outside the runtime's grammar, and one over 64 characters", () => {
    expect(teamNameError("", [])).toMatch(/needs a name/);
    for (const bad of ["my team", "a/b", "a.b", "a:b", "tëam", "a".repeat(65)]) {
      expect(teamNameError(bad, []), bad).toMatch(/one segment/);
    }
  });

  it("refuses a name another team has — a create there would replace that team's active version", () => {
    expect(teamNameError("marketing", ["marketing"])).toMatch(/already exists/);
  });
});

describe("importDefinition", () => {
  const def = { entry: "s", states: [{ state: "s", handler: { kind: "terminal" } }], transitions: [] };

  it("reads a definition", () => {
    expect(importDefinition(JSON.stringify(def))).toEqual({ ok: true, def });
  });

  it("unwraps a stored version as the runtime returns it", () => {
    const row = { def_id: "tdf_1", name: "blog", version: 3, definition: def };
    expect(importDefinition(JSON.stringify(row, null, 2))).toEqual({ ok: true, def });
  });

  it("keeps a definition that has its own `definition` key as it is", () => {
    const odd = { ...def, definition: { states: [] } };
    expect(importDefinition(JSON.stringify(odd))).toEqual({ ok: true, def: odd });
  });

  it("says where the text stops being JSON", () => {
    const r = importDefinition('{\n  "entry": "s",\n  "states": [}\n');
    expect(r).toMatchObject({ ok: false, position: { line: 3 } });
  });

  it("refuses empty text, and JSON that is not a team", () => {
    expect(importDefinition("  \n")).toEqual({ ok: false, message: "nothing to import" });
    expect(importDefinition('{"hello": 1}')).toMatchObject({ ok: false, message: expect.stringMatching(/not a team definition/) });
    expect(importDefinition('{"definition": {"x": 1}}')).toMatchObject({ ok: false });
  });
});

describe("importNotes — what an import carries that the graph does not draw", () => {
  const graph = { entry: "s", states: [{ state: "s", handler: { kind: "agent", agent: "a" } }], transitions: [] };

  it("has nothing to say about a plain graph, its variables and its layout", () => {
    expect(importNotes({ ...graph, vars: { tone: "plain" }, layout: { nodes: {} }, colors: {} })).toEqual([]);
  });

  it("lists walk hooks and state hooks by count, flagging the ones that call a URL, without the URL", () => {
    const notes = importNotes({
      ...graph,
      hooks: { run_end: ["audit", { name: "x", url: "https://evil.example/?token=SECRET" }] },
      states: [
        { state: "s", handler: { kind: "agent", agent: "a", hooks: { agent_stop: ["gate"] }, tool_hooks: { pre: [{ name: "y", url: "https://h.example" }] } } },
        { state: "t", handler: { kind: "terminal" } },
      ],
    });
    expect(notes).toEqual([
      "Walk hooks: 2 hooks, 1 calling a URL written in the definition",
      "Hooks on state s: 2 hooks, 1 calling a URL written in the definition",
    ]);
    expect(notes.join(" ")).not.toMatch(/evil|SECRET|h\.example/);
  });

  it("lists the team's own definitions by name, and a webhook that takes unauthenticated calls", () => {
    expect(
      importNotes({
        ...graph,
        local: {
          agents: { reviewer: { tools: ["Bash"] } },
          channels: {},
          webhooks: { inbound: { auth: { kind: "none" }, channel: "./c" }, signed: { auth: { kind: "hmac" }, channel: "./c" } },
          schedules: { nightly: { schedule: "@hourly", channel: "./c" } },
        },
      }),
    ).toEqual([
      "The team's own agents: reviewer",
      "The team's own webhooks: inbound, signed (no authentication: inbound)",
      "The team's own schedules: nightly",
    ]);
  });

  it("reads keys as the runtime does — Go matches them case-insensitively — so another spelling hides nothing", () => {
    // Regression: `"Hooks"` and `"LOCAL"` were read as nothing, and the import went through unreviewed.
    const notes = importNotes({
      entry: "s",
      States: [{ State: "s", Handler: { kind: "agent", agent: "a", Tool_Hooks: { pre: [{ name: "y", url: "https://h.example" }] } } }],
      transitions: [],
      Hooks: { run_end: ["audit"] },
      LOCAL: { Webhooks: { inbound: { Auth: { Kind: "none" }, channel: "./c" } } },
      Channels: { Publish: ["alerts"] },
      "hook\u017f": { run_end: [{ name: "z", url: "https://k.example" }] },
    });
    expect(notes).toEqual([
      '"States" is another spelling of states: loomcycle 1.107 refuses it on save, and an older runtime reads it as states',
      '"Hooks" is another spelling of hooks: loomcycle 1.107 refuses it on save, and an older runtime reads it as hooks',
      '"LOCAL" is another spelling of local: loomcycle 1.107 refuses it on save, and an older runtime reads it as local',
      '"Channels" is another spelling of channels: loomcycle 1.107 refuses it on save, and an older runtime reads it as channels',
      '"hook\u017f" is another spelling of hooks: loomcycle 1.107 refuses it on save, and an older runtime reads it as hooks',
      '"Hooks" and "hook\u017f" are one key to loomcycle if they name a field: 1.107 refuses that on save, and an older runtime runs the last one',
      "Walk hooks: 2 hooks, 1 calling a URL written in the definition",
      "Hooks on state s: 1 hook, 1 calling a URL written in the definition",
      "The team's own webhooks: inbound (no authentication: inbound)",
      "Channels it may publish to: alerts",
    ]);
  });

  it("lists a section it cannot read, and a top-level key the canvas does not know, rather than passing them", () => {
    expect(importNotes({ ...graph, hooks: "audit", local: { agents: ["x"], plugins: { p: {} } }, channels: { admin: ["*"] }, extras: 1 })).toEqual([
      "Walk hooks: present, in a form this summary cannot count",
      "The team's own agents: present, in a form this summary cannot read",
      "The team's own plugins: p",
      "Channel grants (admin): *",
      "A key the canvas does not know: extras (loomcycle 1.107 refuses an unknown key on save; an older runtime drops it)",
    ]);
  });

  it("lists two spellings of one key — the canvas draws one, the runtime may run the other", () => {
    const notes = importNotes({
      entry: "s",
      states: [{ state: "s", handler: { kind: "agent", agent: "harmless", Agent: "privileged" } }],
      transitions: [],
    });
    expect(notes).toEqual([
      '"agent" and "Agent" in states[0].handler are one key to loomcycle if they name a field: 1.107 refuses that on save, and an older runtime runs the last one',
    ]);
  });

  it("has nothing to say about sections that are present and empty", () => {
    expect(importNotes({ ...graph, hooks: {}, local: { agents: {} }, channels: { publish: [] } })).toEqual([]);
  });

  it("lists the channels the team is granted", () => {
    expect(importNotes({ ...graph, channels: { publish: ["alerts"], subscribe: ["inbox", "ops"] } })).toEqual([
      "Channels it may publish to: alerts",
      "Channels it may read: inbox, ops",
    ]);
  });
});

describe("exportFileName", () => {
  it("names the file after the team, or team.json for one not saved yet", () => {
    expect(exportFileName("blog")).toBe("blog.json");
    expect(exportFileName(null)).toBe("team.json");
  });
});
