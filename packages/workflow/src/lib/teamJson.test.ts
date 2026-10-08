import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromDefinition, toDefinition, type JsonObject } from "./model";
import { formatDefinition, locate, parseDefinition, pathToString, stateIndexAt } from "./teamJson";
import { findingPath, validateModel } from "./validate";

const cases: { name: string; definition: JsonObject }[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../testdata/validate-cases.json", import.meta.url)), "utf8"),
).cases;

describe("formatDefinition / parseDefinition", () => {
  it("round-trips every shared fixture: text → parse → canvas model → definition is the definition", () => {
    // The guarantee the JSON view rests on: nothing a definition can say is
    // lost by showing it as text and reading it back through the canvas.
    for (const c of cases) {
      if (typeof c.definition !== "object" || c.definition === null || Array.isArray(c.definition)) continue;
      const parsed = parseDefinition(formatDefinition(c.definition));
      expect(parsed.ok, c.name).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.def, c.name).toEqual(c.definition);
      expect(toDefinition(fromDefinition(parsed.def)), c.name).toEqual(c.definition);
    }
  });

  it("keeps the definition's key order, an unknown kind and an unknown key", () => {
    const def = { zeta: 1, entry: "s", states: [{ state: "s", handler: { kind: "from-a-newer-runtime", knob: [1, { a: null }] } }], transitions: [] };
    const text = formatDefinition(def);
    expect(text.indexOf('"zeta"')).toBeLessThan(text.indexOf('"entry"'));
    const parsed = parseDefinition(text);
    expect(parsed.ok && toDefinition(fromDefinition(parsed.def))).toEqual(def);
  });

  it("reads strings and numbers exactly as JSON.parse does", () => {
    const text = '{"s": "a\\"b\\n\\u00e9 \\ud83d\\ude00", "n": -1.5e3, "z": 0, "t": true, "f": false, "x": null, "e": [], "o": {}}';
    const parsed = parseDefinition(text);
    expect(parsed.ok && parsed.def).toEqual(JSON.parse(text));
  });

  const error = (text: string) => {
    const r = parseDefinition(text);
    if (r.ok) throw new Error("parsed");
    return { message: r.message, line: r.position.line, column: r.position.column };
  };

  it("names a syntax error and puts it at its line and column", () => {
    expect(error('{\n  "entry": "a"\n  "states": []\n}')).toEqual({ message: 'expected "," or "}" after a value, found "\\""', line: 3, column: 3 });
    expect(error('{\n  "states": [1, 2,]\n}')).toMatchObject({ message: expect.stringMatching(/trailing comma/), line: 2 });
    expect(error('{"a": "unclosed}')).toMatchObject({ message: "a string is not closed", line: 1, column: 7 });
    expect(error('{"a": "line\nbreak"}')).toMatchObject({ message: expect.stringMatching(/control character/), line: 1 });
    expect(error('{"a": tru}')).toMatchObject({ message: expect.stringMatching(/expected a value/), column: 7 });
    expect(error('{"a": 1} x')).toMatchObject({ message: expect.stringMatching(/after the end/), column: 10 });
  });

  it("refuses a key typed twice — JSON.parse would keep the last one silently", () => {
    expect(error('{\n  "entry": "a",\n  "entry": "b"\n}')).toEqual({
      message: 'the key "entry" appears twice in this object',
      line: 3,
      column: 3,
    });
  });

  it("refuses a root that is not an object, and empty text", () => {
    expect(error("[1]").message).toMatch(/must be a JSON object/);
    expect(error("   ").message).toMatch(/empty/);
  });
});

describe("pathToString / locate", () => {
  const text = formatDefinition({
    entry: "s",
    states: [
      { state: "s", handler: { kind: "agent", agent: "./writer" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "s", to: "done", on: "success" }],
    local: { agents: { "my.writer": { tier: "low" } } },
  });
  const lineOf = (needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

  it("spells a path the way an author reads it", () => {
    expect(pathToString(["states", 0, "handler", "agent"])).toBe("states[0].handler.agent");
    expect(pathToString(["local", "agents", "my.writer"])).toBe('local.agents["my.writer"]');
    expect(pathToString([])).toBe("");
  });

  it("finds a member at its key, an array element at its value, and a quoted key", () => {
    expect(locate(text, ["states", 0, "handler", "agent"])?.line).toBe(lineOf('"agent": "./writer"'));
    expect(locate(text, ["transitions", 0])?.line).toBe(lineOf('"from": "s"') - 1);
    expect(locate(text, ["local", "agents", "my.writer"])?.line).toBe(lineOf('"my.writer"'));
  });

  it("falls back to the nearest place the text has, and says nothing for text that does not parse", () => {
    expect(locate(text, ["states", 1, "handler", "consolidator"])?.line).toBe(lineOf('"kind": "terminal"') - 1);
    expect(locate("{", ["entry"])).toBeUndefined();
  });

  it("places a canvas finding on its line in the text", () => {
    // `./writer` names a local agent the team does not declare.
    const def = JSON.parse(text) as JsonObject;
    const model = fromDefinition(def);
    const f = validateModel(model).find((x) => /names a local agent/.test(x.message))!;
    expect(findingPath(model, f)).toEqual(["states", 0, "handler", "agent"]);
    expect(locate(text, findingPath(model, f))?.line).toBe(lineOf('"agent": "./writer"'));
  });
});

describe("stateIndexAt — which state the cursor is in", () => {
  const text = [
    "{",
    '  "entry": "a",',
    '  "states": [',
    "    {",
    '      "state": "a",',
    '      "handler": { "kind": "agent", "agent": "x" }',
    "    },",
    "    {",
    '      "state": "b",',
    '      "handler": { "kind": "terminal" }',
    "    }",
    "  ],",
    '  "transitions": [{ "from": "a", "to": "b", "on": "success" }]',
    "}",
  ].join("\n");
  const parsed = parseDefinition(text);
  if (!parsed.ok) throw new Error("fixture does not parse");
  const at = (needle: string) => stateIndexAt(parsed.positions, text.indexOf(needle));

  it("finds the state a position inside it belongs to", () => {
    expect(at('"state": "a"')).toBe(0);
    expect(at('"agent": "x"')).toBe(0);
    expect(at('"state": "b"')).toBe(1);
    expect(at('"kind": "terminal"')).toBe(1);
  });

  it("is in no state before the list, or after it", () => {
    expect(at('"entry"')).toBeUndefined();
    expect(at('"states"')).toBeUndefined();
    expect(at('"transitions"')).toBeUndefined();
    expect(at('"from": "a"')).toBeUndefined();
    expect(stateIndexAt(parsed.positions, text.length)).toBeUndefined();
  });

  it("is in no state when the definition has none, or states is the last key", () => {
    const none = parseDefinition('{ "entry": "a", "transitions": [] }');
    expect(none.ok && stateIndexAt(none.positions, 5)).toBeUndefined();
    const last = '{ "entry": "a", "states": [ { "state": "a" } ] }';
    const p = parseDefinition(last);
    expect(p.ok && stateIndexAt(p.positions, last.indexOf('"state": "a"'))).toBe(0);
  });
});

