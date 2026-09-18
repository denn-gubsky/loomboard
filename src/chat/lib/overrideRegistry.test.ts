import { describe, expect, it } from "vitest";
import { agentDefRegistry } from "@loomcycle/def-fields";
import type { LibraryAgentDefinition } from "@loomcycle/client";
import { NEXT_RUN, THIS_CHAT, buildOverrideRegistry } from "./overrideRegistry";
import { RETUNABLE_KEYS, START_ONLY_KEYS } from "./overrides";

const reg = () => buildOverrideRegistry();

describe("buildOverrideRegistry", () => {
  // THE DRIFT GUARD. @loomcycle/def-fields is 0.x and the panel selects from it
  // by key, so a rename upstream would silently drop a field from the panel.
  // This turns that into a red build naming the key.
  it("every key the panel wants resolves in agentDefRegistry", () => {
    const known = new Set(agentDefRegistry.fields.map((f) => f.key));
    const missing = [...RETUNABLE_KEYS, ...START_ONLY_KEYS].filter((k) => !known.has(k));
    expect(missing).toEqual([]);
  });

  it("renders every override the mapper can send, and nothing else", () => {
    expect(reg().fields.map((f) => f.key).sort()).toEqual(
      [...RETUNABLE_KEYS, ...START_ONLY_KEYS].sort(),
    );
  });

  // Lifted from packages/workflow's registry test, which exists because a field
  // naming an undeclared group never appears at all.
  it("every field's group is declared", () => {
    const r = reg();
    const declared = new Set(r.groups.map((g) => g.name));
    for (const f of r.fields) expect(declared).toContain(f.group);
  });

  it("splits the two lifetimes, and puts no key in both", () => {
    const r = reg();
    const chat = r.fields.filter((f) => f.group === THIS_CHAT).map((f) => f.key);
    const next = r.fields.filter((f) => f.group === NEXT_RUN).map((f) => f.key);
    expect(chat.sort()).toEqual([...RETUNABLE_KEYS].sort());
    expect(next.sort()).toEqual([...START_ONLY_KEYS].sort());
    expect(chat.filter((k) => next.includes(k))).toEqual([]);
  });

  // agentDefRegistry files max_tokens and max_context_tokens both under
  // "Limits". Keeping that grouping would imply they behave alike; one is
  // retunable on this conversation and the other is not.
  it("regroups the Limits fields by lifetime, not by subject", () => {
    const r = reg();
    const at = (k: string) => r.fields.find((f) => f.key === k)?.group;
    expect(at("max_tokens")).toBe(THIS_CHAT);
    expect(at("max_context_tokens")).toBe(NEXT_RUN);
  });

  it("warns on every start-only field that it misses the run in progress", () => {
    const r = reg();
    for (const f of r.fields.filter((x) => x.group === NEXT_RUN)) {
      expect(f.hint).toContain("next new run");
    }
  });

  it("states the authority rules a field cannot show on its own", () => {
    const r = reg();
    const hint = (k: string) => r.fields.find((f) => f.key === k)?.hint ?? "";
    expect(hint("model")).toContain("PINS");
    expect(hint("max_concurrent_children")).toContain("LOWERED");
  });
});

describe("buildOverrideRegistry — inherited values", () => {
  const baseDef = {
    model: "claude-sonnet-5",
    tier: "middle",
    max_iterations: 24,
  } as LibraryAgentDefinition;

  it("names the value an unset field would inherit, for the keys the report carries", () => {
    const r = buildOverrideRegistry(baseDef);
    const f = (k: string) => r.fields.find((x) => x.key === k);
    expect(f("model")?.unsetMeans).toBe("the agent's own: claude-sonnet-5");
    expect(f("model")?.placeholder).toBe("claude-sonnet-5");
    expect(f("max_iterations")?.unsetMeans).toBe("the agent's own: 24");
  });

  it("leaves the registry's own prose for a key the report does not carry", () => {
    const r = buildOverrideRegistry(baseDef);
    const retry = r.fields.find((x) => x.key === "retry_attempts");
    const upstream = agentDefRegistry.fields.find((x) => x.key === "retry_attempts");
    expect(retry?.unsetMeans).toBe(upstream?.unsetMeans);
  });

  it("falls back cleanly with no baseDef — a user token cannot read the library", () => {
    const r = buildOverrideRegistry(undefined);
    const upstream = agentDefRegistry.fields.find((x) => x.key === "model");
    expect(r.fields.find((x) => x.key === "model")?.unsetMeans).toBe(upstream?.unsetMeans);
  });

  it("ignores an empty reported value rather than claiming an inherit of nothing", () => {
    const r = buildOverrideRegistry({ model: "" } as LibraryAgentDefinition);
    const upstream = agentDefRegistry.fields.find((x) => x.key === "model");
    expect(r.fields.find((x) => x.key === "model")?.unsetMeans).toBe(upstream?.unsetMeans);
  });
});
