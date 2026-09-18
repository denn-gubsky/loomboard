import { describe, expect, it } from "vitest";
import type { EffectiveValue } from "@loomcycle/client";
import {
  describeEffective,
  effectiveFields,
  formatValue,
  placeholderFor,
} from "./effective";

const ev = (value: unknown, source: EffectiveValue["source"]): EffectiveValue =>
  ({ value, source });

describe("formatValue", () => {
  it("renders scalars as themselves", () => {
    expect(formatValue(16)).toBe("16");
    expect(formatValue("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  // A meaningful zero is a real setting, not an absence — the same rule the
  // override mapper follows all the way to the wire.
  it("renders a meaningful zero rather than swallowing it", () => {
    expect(formatValue(0)).toBe("0");
    expect(formatValue(false)).toBe("off");
  });

  it("says on/off for booleans, which read better than true/false here", () => {
    expect(formatValue(true)).toBe("on");
  });

  it("summarises an object by its keys — a JSON blob in a hint is noise", () => {
    expect(formatValue({ temperature: 0.7, top_p: 1 })).toBe("temperature, top_p");
  });

  it("treats absent, null and empty as nothing to show", () => {
    expect(formatValue(undefined)).toBeNull();
    expect(formatValue(null)).toBeNull();
    expect(formatValue("")).toBeNull();
    expect(formatValue([])).toBeNull();
    expect(formatValue({})).toBeNull();
  });
});

describe("describeEffective", () => {
  it("names the value AND the layer that decided it", () => {
    expect(describeEffective(ev(16, "default"))).toBe("In force: 16 (runtime default).");
    expect(describeEffective(ev("middle", "definition"))).toBe(
      "In force: middle (from the agent).",
    );
    expect(describeEffective(ev(2, "user_tier"))).toBe("In force: 2 (from your tier).");
    expect(describeEffective(ev("gpt-5", "resolved"))).toBe(
      "In force: gpt-5 (resolved at run time).",
    );
  });

  it("marks a value this chat overrides, so it is not mistaken for inherited", () => {
    expect(describeEffective(ev("gemma4:latest", "run"))).toBe(
      "In force: gemma4:latest (set for this chat).",
    );
  });

  // The report deliberately returns a null value with source "resolved" when the
  // runtime settles a field somewhere it cannot see. Saying so beats implying
  // the field is unset.
  it("reports an unknowable resolved field instead of hiding it", () => {
    expect(describeEffective(ev(null, "resolved"))).toBe(
      "In force: decided at run time.",
    );
  });

  it("stays silent when there is nothing honest to say", () => {
    expect(describeEffective(undefined)).toBeNull();
    expect(describeEffective(ev(null, "default"))).toBeNull();
  });

  it("falls back to the raw source name if loomcycle adds a layer", () => {
    expect(describeEffective(ev(1, "brand_new" as EffectiveValue["source"]))).toBe(
      "In force: 1 (brand_new).",
    );
  });
});

describe("placeholderFor", () => {
  it("previews an inherited scalar", () => {
    expect(placeholderFor(ev("claude-sonnet-5", "definition"))).toBe("claude-sonnet-5");
    expect(placeholderFor(ev(16, "default"))).toBe("16");
  });

  // An overridden field already shows its value in the control; a placeholder
  // would be invisible there anyway, and claiming it as inherited is wrong.
  it("offers nothing for a field this run overrides", () => {
    expect(placeholderFor(ev("gemma4:latest", "run"))).toBeNull();
  });

  it("offers nothing for a shape a text box cannot preview", () => {
    expect(placeholderFor(ev(true, "default"))).toBeNull();
    expect(placeholderFor(ev({ temperature: 1 }, "definition"))).toBeNull();
    expect(placeholderFor(ev(null, "resolved"))).toBeNull();
  });
});

describe("effectiveFields", () => {
  it("is an empty map with no report — a chat with no run yet is normal", () => {
    expect(effectiveFields(null)).toEqual({});
  });

  it("passes the report's fields through, keyed by wire name", () => {
    const fields = { max_tokens: ev(2048, "run") };
    expect(effectiveFields({ run_id: "r", agent: "a", fields })).toBe(fields);
  });
});
