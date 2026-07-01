import { describe, it, expect } from "vitest";
import { configIsCustom, sameConfig } from "./conversations";

describe("configIsCustom", () => {
  it("is false for an empty config (pure inherit)", () => {
    expect(configIsCustom({})).toBe(false);
  });
  it("is true when any override is set", () => {
    expect(configIsCustom({ model: "gemma4:latest" })).toBe(true);
    expect(configIsCustom({ effort: "high" })).toBe(true);
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

  it("matches identical overrides regardless of key order", () => {
    expect(
      sameConfig(
        { provider: "ollama-local", model: "qwen3.6:latest", effort: "high" },
        { effort: "high", model: "qwen3.6:latest", provider: "ollama-local" },
      ),
    ).toBe(true);
  });
});
