import { describe, expect, it } from "vitest";
import { chunkOptions, fieldsPatch, formInput, inputFields, placeInput, startFindings, startPlan, type InputField } from "./inputForm";
import { fromDefinition, handlerOf, patchHandler, toDefinition, type CanvasNode } from "./model";

// The pcparts team's form: the expected input is {document_id, chunk_id},
// both picked rather than typed, both bound as ${var.*}.
const PCPARTS_SCHEMA = {
  type: "object",
  required: ["document_id", "chunk_id"],
  properties: {
    document_id: { type: "string", title: "Document", "x-loomcycle-picker": { kind: "document", scope: "user", under_path: "/loomboard/tests" } },
    chunk_id: { type: "string", title: "Part", "x-loomcycle-picker": { kind: "chunk", document: "document_id", depth: 1 } },
  },
};

const team = (input?: Record<string, unknown>) =>
  fromDefinition({
    entry: input ? "form" : "research",
    states: [
      ...(input ? [{ state: "form", handler: { kind: "input", ...input } }] : []),
      { state: "research", handler: { kind: "starter", source: { channel: "pcparts-in" }, fanout: { agent: "r", max: 1 }, sink: { channel: "handoff" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      ...(input ? [{ from: "form", to: "research", on: "success" }] : []),
      { from: "research", to: "done", on: "success" },
    ],
  });

const node = (m: ReturnType<typeof team>, id = "form") => m.nodes.find((n) => n.id === id) as CanvasNode;

describe("inputFields", () => {
  it("reads the form's fields, the pickers, and the variable each one binds", () => {
    const m = team({ schema: PCPARTS_SCHEMA, capture: { document_id: "$.document_id", chunk_id: "$.chunk_id" } });
    expect(inputFields(node(m))).toEqual([
      { name: "document_id", title: "Document", type: "string", required: true, picker: { kind: "document", scope: "user", underPath: "/loomboard/tests" }, variable: "document_id" },
      { name: "chunk_id", title: "Part", type: "string", required: true, picker: { kind: "chunk", document: "document_id", depth: 1 }, variable: "chunk_id" },
    ]);
  });

  it("orders the form by `required` — the runtime sorts object keys, so properties come back alphabetical", () => {
    // As TrueNAS stores pcparts v2: chunk_id first. The chunk picker follows
    // the document field, so the document must be asked for first.
    const sorted = { ...PCPARTS_SCHEMA, properties: { chunk_id: PCPARTS_SCHEMA.properties.chunk_id, document_id: PCPARTS_SCHEMA.properties.document_id, tone: { type: "string" } } };
    expect(inputFields(node(team({ schema: sorted }))).map((f) => f.name)).toEqual(["document_id", "chunk_id", "tone"]);
  });

  it("calls a field unbound when no capture reads it, and a plain-text form fieldless", () => {
    expect(inputFields(node(team({ schema: PCPARTS_SCHEMA })))[0].variable).toBeUndefined();
    expect(inputFields(node(team({})))).toEqual([]);
  });
});

describe("fieldsPatch", () => {
  it("round-trips: the fields it writes read back as the same fields", () => {
    const m = team({ schema: PCPARTS_SCHEMA, capture: { document_id: "$.document_id", chunk_id: "$.chunk_id" } });
    const fields = inputFields(node(m));
    expect(inputFields(patchHandler(node(m), fieldsPatch(node(m), fields)))).toEqual(fields);
  });

  it("keeps what the editor does not own: other keywords and an author's own capture", () => {
    const m = team({
      schema: { ...PCPARTS_SCHEMA, title: "Pick a part", properties: { ...PCPARTS_SCHEMA.properties, tone: { type: "string", enum: ["warm", "dry"] } } },
      capture: { whole: "$", tone_var: "$.tone" },
    });
    const fields: InputField[] = inputFields(node(m)).map((f) => (f.name === "tone" ? { ...f, variable: undefined } : f));
    const p = fieldsPatch(node(m), fields);
    const schema = p.schema as { title: string; properties: Record<string, Record<string, unknown>> };
    expect(schema.title).toBe("Pick a part");
    expect(schema.properties.tone.enum).toEqual(["warm", "dry"]);
    // `$` is not a field read: the author's, kept. `$.tone` was the editor's
    // and the field is now unbound: dropped.
    expect(p.capture).toEqual({ whole: "$" });
  });
});

describe("formInput", () => {
  const fields = inputFields(node(team({ schema: PCPARTS_SCHEMA })));

  it("builds the team's expected input — {document_id, chunk_id} — as JSON", () => {
    const r = formInput(fields, { document_id: "doc1", chunk_id: "chunk9" });
    expect(r.errors).toEqual({});
    expect(JSON.parse(r.input)).toEqual({ document_id: "doc1", chunk_id: "chunk9" });
    expect(r.value).toEqual({ document_id: "doc1", chunk_id: "chunk9" });
  });

  it("names each missing required field, and types numbers and booleans", () => {
    expect(formInput(fields, { document_id: "doc1" }).errors).toEqual({ chunk_id: "required" });
    const typed: InputField[] = [
      { name: "n", type: "integer", required: false },
      { name: "x", type: "number", required: false },
      { name: "b", type: "boolean", required: false },
    ];
    expect(formInput(typed, { n: "2.5" }).errors).toEqual({ n: "a whole number" });
    expect(JSON.parse(formInput(typed, { n: "3", x: "0.5", b: true }).input)).toEqual({ n: 3, x: 0.5, b: true });
  });

  it("sends a fieldless form's plain text as is", () => {
    expect(formInput([], {}, "write about GPUs")).toMatchObject({ input: "write about GPUs", value: { text: "write about GPUs" } });
  });
});

describe("startPlan", () => {
  it("only runs, even in front of a Starter reading a channel — the Input's `publish` puts the form there", () => {
    expect(startPlan(team({ schema: PCPARTS_SCHEMA, publish: { channel: "pcparts-in" } }))).toEqual({ input: "form", next: "research" });
  });

  it("only runs when the Input leads to an agent, and has no plan without an Input entry", () => {
    const m = fromDefinition({
      entry: "form",
      states: [
        { state: "form", handler: { kind: "input" } },
        { state: "write", handler: { kind: "agent", agent: "w" } },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [
        { from: "form", to: "write", on: "success" },
        { from: "write", to: "done", on: "success" },
      ],
    });
    expect(startPlan(m)).toEqual({ input: "form", next: "write" });
    expect(startPlan(team())).toBeUndefined();
  });
});

describe("startFindings", () => {
  it("says when an Input leads to a channel Starter it does not publish to — Start would leave it waiting", () => {
    const [f] = startFindings(team({ schema: PCPARTS_SCHEMA }));
    expect(f).toMatchObject({ level: "info", nodeId: "form" });
    expect(f.message).toContain('reads channel "pcparts-in"');
  });

  it("is quiet once the Input publishes there, and for a team with no channel Starter after its Input", () => {
    expect(startFindings(team({ publish: { channel: "pcparts-in" } }))).toEqual([]);
    expect(startFindings(team())).toEqual([]);
  });
});

describe("placeInput", () => {
  it("makes a new Input the ENTRY, wired into the old entry — never a loose, unreachable state", () => {
    // Regression: the palette dropped it loose — "unreachable from entry" and
    // "dead end" the moment it was placed.
    const m = team();
    const { model, id, existing } = placeInput(m, { state: "input-1", handler: { kind: "input" } });
    expect(existing).toBe(false);
    expect(model.entry).toBe("input-1");
    expect(model.edges.some((e) => e.from === id && e.to === "research" && e.on === "success")).toBe(true);
    expect(toDefinition(model).entry).toBe("input-1");
    // In front of a Starter reading a channel, it publishes the form there.
    expect(handlerOf(model.nodes.find((n) => n.id === id)!).publish).toEqual({ channel: "pcparts-in" });
    // Left of everything drawn, so it reads first.
    expect(model.nodes.find((n) => n.id === id)!.position.x).toBeLessThan(Math.min(...m.nodes.map((n) => n.position.x)));
  });

  it("does not add a second Input to a team that already starts with one", () => {
    const m = team({ schema: PCPARTS_SCHEMA });
    const r = placeInput(m, { state: "input-2", handler: { kind: "input" } });
    expect(r).toMatchObject({ existing: true, id: "form" });
    expect(r.model).toBe(m);
  });
});

describe("chunkOptions", () => {
  const rows = [
    { id: "root", title: "PC Parts Catalog", position: 0, parent_id: null },
    { id: "gpu", title: "RTX 4070 Super", position: 1, parent_id: "root" },
    { id: "cpu", title: "Ryzen 7 7800X3D", position: 0, parent_id: "root" },
    { id: "cpu-research", title: "Research: Ryzen", position: 0, parent_id: "cpu" },
  ];

  it("lists a document's chunks in order, without the title chunk", () => {
    expect(chunkOptions(rows).map((c) => [c.id, c.depth])).toEqual([["cpu", 1], ["cpu-research", 2], ["gpu", 1]]);
  });

  it("keeps the top-level sections only at depth 1 — the parts, not their research", () => {
    expect(chunkOptions(rows, 1).map((c) => c.id)).toEqual(["cpu", "gpu"]);
  });
});

describe("an input-sourced Starter — its own front door (loomcycle #1579)", () => {
  // pcparts v2: no channels, the entry Starter takes the walk's input.
  const v2 = fromDefinition({
    entry: "research",
    states: [
      {
        state: "research",
        handler: {
          kind: "starter",
          source: { kind: "input" },
          schema: PCPARTS_SCHEMA,
          fanout: { agent: "r", per: "message", max: 1 },
          binds: { document_id: "$.document_id", chunk_id: "$.chunk_id" },
        },
      },
      { state: "edit", handler: { kind: "agent", agent: "e" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "research", to: "edit", on: "success" },
      { from: "edit", to: "done", on: "success" },
    ],
  });
  const starter = node(v2, "research");

  it("reads the form from the Starter's schema, and each field's variable from its BINDS", () => {
    expect(inputFields(starter).map((f) => [f.name, f.variable, f.picker?.kind])).toEqual([
      ["document_id", "document_id", "document"],
      ["chunk_id", "chunk_id", "chunk"],
    ]);
  });

  it("writes an edited field list back as `binds`, never `capture` — a Starter binds from its item", () => {
    const fields = inputFields(starter).map((f) => (f.name === "chunk_id" ? { ...f, variable: undefined } : f));
    const p = fieldsPatch(starter, fields);
    expect(p.binds).toEqual({ document_id: "$.document_id" });
    expect("capture" in p).toBe(false);
    expect(inputFields(patchHandler(starter, p)).find((f) => f.name === "chunk_id")!.variable).toBeUndefined();
  });

  it("plans Start as a single run: the Starter takes the input, nothing is published", () => {
    expect(startPlan(v2)).toEqual({ input: "research" });
  });

  it("puts no Input node in front of it — the runtime refuses one that is not the entry", () => {
    expect(placeInput(v2, { state: "input-1", handler: { kind: "input" } })).toMatchObject({ existing: true, id: "research" });
  });
});
