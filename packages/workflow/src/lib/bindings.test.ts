import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BINDING_CLEARANCE,
  BINDING_DROP,
  bindingNodeId,
  bindingNodes,
  bindingFindings,
  bindingUses,
  documentDelivery,
  scanBindings,
  type Binding,
} from "./bindings";
import { fromDefinition, toDefinition } from "./model";

// The TypeScript half of the shared scan cases. The Go half runs the same file
// through loomcycle's combinedPlaceholderRe (see the fixture header) — a scan
// that disagreed with the runtime would draw bindings the agent is never sent.
const CASES: { name: string; text: string; bindings: Binding[] }[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../testdata/binding-cases.json", import.meta.url)), "utf8"),
).cases;

describe("scanBindings — shared cases, also run through the Go regex", () => {
  it("finds the fixture file", () => expect(CASES.length).toBeGreaterThan(10));
  for (const c of CASES) {
    it(c.name, () => expect(scanBindings(c.text)).toEqual(c.bindings));
  }
});

const team = (handlers: Record<string, Record<string, unknown>>) =>
  fromDefinition({
    entry: Object.keys(handlers)[0],
    states: Object.entries(handlers).map(([state, handler]) => ({ state, handler })),
    transitions: [],
    layout: { nodes: Object.fromEntries(Object.keys(handlers).map((s, i) => [s, { x: i * 300, y: 0 }])) },
  });

describe("bindingUses — which prompts name what", () => {
  it("reads system_prompt and input_template on agent kinds, prompt.system / prompt.input on a Starter", () => {
    const m = team({
      a: { kind: "agent", agent: "x", system_prompt: "{{document:/specs/a}}", input_template: "{{memory:key:k}}" },
      s: {
        kind: "starter",
        source: { channel: "c" },
        fanout: { agent: "y", max: 2 },
        prompt: { system: "{{memory:ontology}}", input: "{{document:/specs/b#Risks}}" },
      },
    });
    expect(bindingUses(m).map((u) => `${u.state}.${u.field}:${u.kind}:${u.ref}`)).toEqual([
      "a.system_prompt:document:/specs/a",
      "a.input_template:memory:key:k",
      "s.prompt.system:memory:ontology",
      "s.prompt.input:document:/specs/b#Risks",
    ]);
  });

  it("reads no prompt on kinds that run no agent, nor on an opaque kind", () => {
    const m = team({
      v: { kind: "vars", set: { x: "1" }, system_prompt: "{{document:/nope}}" },
      o: { kind: "from-a-newer-runtime", system_prompt: "{{document:/nope}}" },
    });
    expect(bindingUses(m)).toEqual([]);
  });
});

describe("bindingNodes", () => {
  const m = team({
    a: { kind: "agent", agent: "x", system_prompt: "{{document:/specs/a}} {{memory:core_block}}" },
    b: { kind: "agent", agent: "y", system_prompt: "{{document:/specs/a}}" },
  });
  const views = bindingNodes(m);
  const doc = views.find((v) => v.kind === "document")!;
  const mem = views.find((v) => v.kind === "memory")!;

  it("draws a binding two states read ONCE, with both readers", () => {
    expect(views.filter((v) => v.kind === "document")).toHaveLength(1);
    expect(doc.readers.map((r) => r.state)).toEqual(["a", "b"]);
  });

  it("flags a memory section this runtime does not know — it renders empty", () => {
    expect(mem.unknownVariant).toBe(true);
    const known = bindingNodes(team({ a: { kind: "agent", agent: "x", system_prompt: "{{memory:user_info}}" } }));
    expect(known[0].unknownVariant).toBe(false);
  });

  it("does not call a key/search sub-form an unknown variant", () => {
    const sub = bindingNodes(team({ a: { kind: "agent", agent: "x", system_prompt: "{{memory:key:notes}}" } }));
    expect(sub[0].unknownVariant).toBeUndefined();
  });

  it("places an unplaced binding below the states it feeds, clear of the others", () => {
    expect(doc.position.y).toBe(BINDING_DROP);
    expect(Math.abs(doc.position.x - mem.position.x)).toBeGreaterThanOrEqual(BINDING_CLEARANCE.x);
  });

  it("marks a ref whose value is decided per run", () => {
    const t = bindingNodes(team({ a: { kind: "agent", agent: "x", system_prompt: "{{document:/pr/${var.n}}}" } }));
    expect(t[0].templated).toBe(true);
    expect(doc.templated).toBe(false);
  });

  it("keeps a dragged binding's position through a save", () => {
    const moved = { ...m, layoutDirty: true, derivedPositions: { [doc.id]: { x: 12.4, y: 300.6 } } };
    const out = toDefinition(moved) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes[doc.id]).toEqual({ x: 12, y: 301 });
    expect(bindingNodes(fromDefinition(out)).find((v) => v.id === doc.id)!.placed).toBe(true);
  });

  it("ids a binding by kind and ref", () => {
    expect(bindingNodeId({ kind: "document", ref: "/specs/a" })).toBe("binding:document:/specs/a");
  });
});

describe("documentDelivery (RFC CY Amendment B)", () => {
  it("a whole document by path DIRECTS the agent to read it; a section or an id is inlined", () => {
    expect(documentDelivery("/specs/launch")).toBe("directive");
    expect(documentDelivery("/specs/launch#Risks")).toBe("inlined");
    expect(documentDelivery("5673df64fadb15c431c0eff2e78b5542")).toBe("inlined");
  });
});

describe("bindingNodes — readers", () => {
  it("lists a field once however many times it names the same binding", () => {
    const m = team({ a: { kind: "agent", agent: "x", system_prompt: "{{document:/d}} again {{document:/d}}" } });
    expect(bindingNodes(m)[0].readers).toEqual([{ state: "a", field: "system_prompt" }]);
  });
});

describe("bindingFindings", () => {
  it("flags an unknown section on the node that names it", () => {
    const f = bindingFindings(team({ a: { kind: "agent", agent: "x", system_prompt: "{{memory:core_block}}" } }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "info", nodeId: "a" });
  });

  it("says nothing about a known section, or a key / search sub-form", () => {
    const m = team({
      a: { kind: "agent", agent: "x", system_prompt: "{{memory:user_info}} {{memory:key:k}} {{memory:search:q}}" },
    });
    expect(bindingFindings(m)).toEqual([]);
  });
});
