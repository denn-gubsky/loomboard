import { describe, expect, it } from "vitest";
import { fromDefinition } from "./model";
import { TEAM_TEMPLATES, exportFileName, importDefinition, teamNameError } from "./newTeam";
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

describe("exportFileName", () => {
  it("names the file after the team, or team.json for one not saved yet", () => {
    expect(exportFileName("blog")).toBe("blog.json");
    expect(exportFileName(null)).toBe("team.json");
  });
});
