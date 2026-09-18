import { describe, it, expect } from "vitest";
import {
  configIsCustom,
  migrateConversation,
  sameConfig,
  type Conversation,
} from "./conversations";

describe("configIsCustom", () => {
  it("is false for an empty config (pure inherit)", () => {
    expect(configIsCustom({})).toBe(false);
  });
  it("is true when any override is set", () => {
    expect(configIsCustom({ model: "gemma4:latest" })).toBe(true);
    expect(configIsCustom({ effort: "high" })).toBe(true);
  });

  // The overlay is sparse and several loomcycle knobs have a MEANINGFUL zero:
  // retry_attempts 0 is "do not retry", inject_tool_guide false is "leave it
  // out". A truthiness check reads those as "inherit" and silently drops them.
  it("is true for an override whose value is a meaningful zero", () => {
    expect(configIsCustom({ retry_attempts: 0 })).toBe(true);
    expect(configIsCustom({ inject_tool_guide: false })).toBe(true);
    expect(configIsCustom({ memory_inject_max_tokens: 0 })).toBe(true);
  });

  it("is false when a key is present but empty — empty still means inherit", () => {
    expect(configIsCustom({ effort: "" })).toBe(false);
    expect(configIsCustom({ model: undefined })).toBe(false);
  });
});

describe("sameConfig", () => {
  it("treats missing and empty-string fields as equal (both inherit)", () => {
    expect(sameConfig({}, { model: "", effort: "" })).toBe(true);
    expect(sameConfig({ provider: undefined }, {})).toBe(true);
  });

  it("detects a changed override", () => {
    expect(sameConfig({ model: "a" }, { model: "b" })).toBe(false);
    expect(sameConfig({}, { effort: "high" })).toBe(false);
  });

  // sameConfig drives the panel's dirty check. Keyed on a fixed four-name list
  // it cannot see any other override move, so Apply stays disabled on a real
  // edit — the change is simply unreachable.
  it("detects a change in an override outside the original four keys", () => {
    expect(sameConfig({ max_tokens: 1 }, { max_tokens: 2 })).toBe(false);
    expect(sameConfig({}, { retry_attempts: 0 })).toBe(false);
    expect(sameConfig({ inject_tool_guide: true }, {})).toBe(false);
  });

  it("matches identical overrides regardless of key order", () => {
    expect(
      sameConfig(
        { provider: "ollama-local", model: "qwen3.6:latest", effort: "high" },
        { effort: "high", model: "qwen3.6:latest", provider: "ollama-local" },
      ),
    ).toBe(true);
  });
});

describe("migrateConversation", () => {
  const rec = (config: unknown): Conversation =>
    ({ id: "c1", title: "t", baseAgent: "chat/medium", config, updatedAt: 0 }) as Conversation;

  it("leaves a fork-era record's overrides untouched — there is nothing to rename", () => {
    const c = migrateConversation(
      rec({ provider: "ollama-local", model: "qwen3.6:latest", effort: "high" }),
    );
    expect(c.config).toEqual({
      provider: "ollama-local",
      model: "qwen3.6:latest",
      effort: "high",
    });
  });

  it("strips the empty strings older builds wrote for a cleared field", () => {
    // Left in place these read as set-to-empty and would ride along on every run.
    const c = migrateConversation(rec({ model: "gemma4:latest", effort: "", tier: "" }));
    expect(c.config).toEqual({ model: "gemma4:latest" });
  });

  it("keeps a meaningful zero, which is a real setting and not an empty one", () => {
    const c = migrateConversation(rec({ retry_attempts: 0, inject_tool_guide: false }));
    expect(c.config).toEqual({ retry_attempts: 0, inject_tool_guide: false });
  });

  it("is idempotent, so it needs no version stamp", () => {
    const once = migrateConversation(rec({ model: "m", effort: "" }));
    expect(migrateConversation(once).config).toEqual(once.config);
  });

  it("repairs a record with no config at all", () => {
    expect(migrateConversation(rec(undefined)).config).toEqual({});
  });

  it("preserves a legacy forkDefName — the orphaned def is untraceable without it", () => {
    const c = migrateConversation({ ...rec({}), forkDefName: "chat/medium__lb-1a2b3c4d" });
    expect(c.forkDefName).toBe("chat/medium__lb-1a2b3c4d");
  });
});
