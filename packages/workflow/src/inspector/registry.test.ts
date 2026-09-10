import { describe, expect, it } from "vitest";
import { KNOWN_KINDS } from "../lib/model";
import { fieldsForKind, teamHandlerRegistry } from "./registry";

describe("teamHandlerRegistry", () => {
  it("declares every field under a group the registry lists", () => {
    // def-fields renders by group; a field whose group is not declared would
    // silently never appear.
    const groups = new Set(teamHandlerRegistry.groups.map((g) => g.name));
    for (const f of teamHandlerRegistry.fields) {
      expect(groups, `field ${f.key} has group ${f.group}`).toContain(f.group);
    }
  });

  it("gives every field an operator-facing hint", () => {
    for (const f of teamHandlerRegistry.fields) {
      expect(f.hint.length, `field ${f.key}`).toBeGreaterThan(10);
    }
  });

  it("offers exactly the handler kinds the model renders", () => {
    const kindField = teamHandlerRegistry.fields.find((f) => f.key === "kind")!;
    expect([...(kindField.options ?? [])].sort()).toEqual([...KNOWN_KINDS].sort());
  });
});

describe("fieldsForKind", () => {
  it("shows only what the kind actually uses", () => {
    expect(fieldsForKind("agent")).toEqual(["agent", "consolidator", "timeout_ms"]);
    expect(fieldsForKind("consolidator")).toEqual(["agent", "timeout_ms"]);
    expect(fieldsForKind("parallel")).toEqual(["agents", "consolidator", "wait", "timeout_ms"]);
  });

  it("shows nothing for a terminal state", () => {
    // teamgraph refuses agent/agents/consolidator on a terminal, so offering
    // the fields would only invite an error.
    expect(fieldsForKind("terminal")).toEqual([]);
  });

  it("shows nothing for a kind this build does not know", () => {
    // An opaque node's fields belong to a runtime this canvas predates; the
    // inspector renders them read-only rather than guessing at an editor.
    expect(fieldsForKind("starter")).toEqual([]);
    expect(fieldsForKind("")).toEqual([]);
  });

  it("only ever names fields the registry declares", () => {
    const declared = new Set(teamHandlerRegistry.fields.map((f) => f.key));
    for (const kind of [...KNOWN_KINDS, "starter"]) {
      for (const key of fieldsForKind(kind)) {
        expect(declared, `kind ${kind} names ${key}`).toContain(key);
      }
    }
  });
});
