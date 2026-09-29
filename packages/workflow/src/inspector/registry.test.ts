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
    expect(fieldsForKind("agent")).toEqual([
      "agent",
      "consolidator",
      "system_prompt",
      "input_template",
      "timeout_ms",
      "hooks",
      "tool_hooks",
    ]);
    expect(fieldsForKind("consolidator")).toEqual([
      "agent",
      "system_prompt",
      "input_template",
      "timeout_ms",
      "hooks",
      "tool_hooks",
    ]);
    expect(fieldsForKind("parallel")).toEqual([
      "agents",
      "consolidator",
      "wait",
      "system_prompt",
      "input_template",
      "timeout_ms",
      "hooks",
      "tool_hooks",
    ]);
    expect(fieldsForKind("vars")).toEqual(["set"]);
    expect(fieldsForKind("input")).toEqual(["schema"]);
  });

  it("offers per-node prompts only on kinds that RUN an agent", () => {
    // teamgraph does not refuse system_prompt on a terminal or a vars state,
    // so this is the canvas declining to offer a setting that would have no
    // effect — the same failure the starter-only guards exist to prevent,
    // just one the runtime does not police.
    for (const kind of ["terminal", "channel", "vars", "input", "starter"]) {
      expect(fieldsForKind(kind), kind).not.toContain("system_prompt");
      expect(fieldsForKind(kind), kind).not.toContain("input_template");
    }
  });

  it("keeps `set` and `schema` on the one kind each belongs to", () => {
    // Both are refused elsewhere by teamgraph — an assignment riding an agent
    // handler is invisible, which is what the vars kind exists to fix.
    for (const kind of KNOWN_KINDS) {
      if (kind !== "vars") expect(fieldsForKind(kind), kind).not.toContain("set");
      if (kind !== "input") expect(fieldsForKind(kind), kind).not.toContain("schema");
    }
  });

  it("offers hooks exactly on the kinds that start runs (RFC DK-P4c)", () => {
    // teamgraph refuses hooks elsewhere: "starts no run, so it cannot carry
    // hooks". Offering the editor there would invite exactly that refusal.
    const bearing = new Set(["agent", "parallel", "consolidator", "starter"]);
    for (const kind of KNOWN_KINDS) {
      for (const key of ["hooks", "tool_hooks"]) {
        expect(fieldsForKind(kind).includes(key), `${kind} ${key}`).toBe(bearing.has(kind));
      }
    }
  });

  it("offers the same hook events the loomcycle Web UI offers", () => {
    const f = teamHandlerRegistry.fields.find((x) => x.key === "hooks")!;
    expect(f.type).toBe("hook-events");
    expect(f.options).toContain("agent_stop");
    expect(f.options).not.toContain("channel_publish");
  });

  it("shows nothing for a terminal state", () => {
    // teamgraph refuses agent/agents/consolidator on a terminal, so offering
    // the fields would only invite an error.
    expect(fieldsForKind("terminal")).toEqual([]);
  });

  it("shows nothing for a kind this build does not know", () => {
    // An opaque node's fields belong to a runtime this canvas predates; the
    // inspector renders them read-only rather than guessing at an editor.
    expect(fieldsForKind("from-a-newer-runtime")).toEqual([]);
    expect(fieldsForKind("")).toEqual([]);
  });

  it("only ever names fields the registry declares", () => {
    const declared = new Set(teamHandlerRegistry.fields.map((f) => f.key));
    for (const kind of [...KNOWN_KINDS, "from-a-newer-runtime"]) {
      for (const key of fieldsForKind(kind)) {
        expect(declared, `kind ${kind} names ${key}`).toContain(key);
      }
    }
  });
});
