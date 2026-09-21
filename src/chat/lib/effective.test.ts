import { describe, expect, it } from "vitest";
import type { EffectiveConfigResponse, EffectiveValue } from "@loomcycle/client";
import {
  describeEffective,
  effectiveFields,
  formatValue,
  inertSettings,
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
    expect(effectiveFields({ run_id: "r", agent: "a", inert: [], fields })).toBe(fields);
  });
});

describe("inertSettings", () => {
  // Verbatim from truenas.local:8787 (v1.84.0) for a chat/local run — the
  // payload that answers "autocompaction did not start", which loomboard was
  // discarding. `inert` is NOT declared on EffectiveConfigResponse at 1.84.0,
  // so the cast is the same shape the production narrow has to handle.
  const live = {
    run_id: "r_afccca23caf14587740be31c64c262e7",
    agent: "chat/local",
    fields: {},
    inert: [
      {
        setting: "compaction.autocompact_at_pct",
        reason:
          'context.mode is "auto", and the compaction threshold is only consulted in append ' +
          "mode — every other mode distils by its own path",
        fix: "context.autorecap_at_pct",
      },
      {
        setting: "compaction.memory_flush",
        reason:
          'context.mode is "auto", and that path banks evicted spans only when ' +
          "context.harvest_to_memory is set",
        fix: "context.harvest_to_memory",
      },
    ],
  } as unknown as Parameters<typeof inertSettings>[0];

  it("reads the advisories the SDK type does not declare", () => {
    const got = inertSettings(live);
    expect(got).toHaveLength(2);
    expect(got[0].setting).toBe("compaction.autocompact_at_pct");
    expect(got[0].fix).toBe("context.autorecap_at_pct");
  });

  it("relays the runtime's reason verbatim", () => {
    // Rewriting it is how the declined-distillation notice ended up printing
    // its own clause twice; the server knows which setting disables which.
    expect(inertSettings(live)[0].reason).toBe(
      'context.mode is "auto", and the compaction threshold is only consulted in append mode' +
        " — every other mode distils by its own path",
    );
  });

  it("is empty for an older runtime that does not report inert at all", () => {
    // The cast is the POINT, not a convenience: client 1.86.0 types `inert` as
    // required, so the compiler cannot express a response that omits it — yet
    // a runtime older than the type does exactly that, and this build still
    // talks to those. Writing `inert: []` here to satisfy the compiler would
    // silently convert this into a duplicate of the empty-array case above and
    // delete the only coverage of the omitted one.
    const older = { run_id: "r", agent: "a", fields: {} } as unknown as EffectiveConfigResponse;
    expect(inertSettings(older)).toEqual([]);
  });

  it("is empty when there is no report — a chat with no live run", () => {
    expect(inertSettings(null)).toEqual([]);
  });

  it("skips a row missing the two fields an advisory needs", () => {
    // Better to say nothing than "undefined cannot take effect".
    const odd = {
      run_id: "r",
      agent: "a",
      fields: {},
      inert: [{ setting: "x" }, { reason: "y" }, null, "nope", { setting: "ok", reason: "why" }],
    } as unknown as Parameters<typeof inertSettings>[0];
    expect(inertSettings(odd)).toEqual([{ setting: "ok", reason: "why" }]);
  });

  it("omits an empty fix rather than offering a blank alternative", () => {
    const noFix = {
      run_id: "r",
      agent: "a",
      fields: {},
      inert: [{ setting: "s", reason: "r", fix: "" }],
    } as unknown as Parameters<typeof inertSettings>[0];
    expect(inertSettings(noFix)[0].fix).toBeUndefined();
  });
});
