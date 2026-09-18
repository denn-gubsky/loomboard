import { describe, expect, it } from "vitest";
import {
  RETUNABLE_KEYS,
  START_ONLY_KEYS,
  hasOverrides,
  retunePayload,
  toRunOverrides,
  toStartOnlyOptions,
} from "./overrides";

describe("toRunOverrides", () => {
  it("maps the overlay's snake_case keys onto the client's camelCase options", () => {
    expect(
      toRunOverrides({ model: "gemma4:latest", max_tokens: 2048, inject_tool_guide: true }),
    ).toEqual({ model: "gemma4:latest", maxTokens: 2048, injectToolGuide: true });
  });

  it("emits nothing for an empty overlay", () => {
    // Object.keys, not toEqual({}) — `{model: undefined}` passes a deep-equal
    // against {} and is exactly the bug this guards.
    expect(Object.keys(toRunOverrides({}))).toHaveLength(0);
  });

  it("never materialises a key the overlay does not carry", () => {
    const out = toRunOverrides({ model: "x" });
    expect("provider" in out).toBe(false);
    expect(Object.keys(out)).toEqual(["model"]);
  });

  // The load-bearing case. loomcycle stores these as POINTERS so that "do not
  // retry" and "inject nothing" are expressible at all; a truthiness gate drops
  // them and the run silently keeps the agent's value.
  it("carries a meaningful zero through to the wire", () => {
    expect(toRunOverrides({ retry_attempts: 0 })).toEqual({ retryAttempts: 0 });
    expect(toRunOverrides({ memory_inject_max_tokens: 0 })).toEqual({
      memoryInjectMaxTokens: 0,
    });
    expect(toRunOverrides({ memory_index_max_bytes: 0 })).toEqual({
      memoryIndexMaxBytes: 0,
    });
  });

  it("carries an explicit false through to the wire", () => {
    expect(toRunOverrides({ inject_tool_guide: false })).toEqual({
      injectToolGuide: false,
    });
    expect(toRunOverrides({ unbounded_iterations: false })).toEqual({
      unboundedIterations: false,
    });
  });

  it('treats "" as inherit — it is what the editor emits for a cleared box', () => {
    expect(Object.keys(toRunOverrides({ effort: "", model: "" }))).toHaveLength(0);
  });

  it("drops a key that is not in the override vocabulary", () => {
    expect(toRunOverrides({ system_prompt: "nope", tools: ["Read"] })).toEqual({});
  });

  it("keeps start-only keys out — sending one to a retune is a 422", () => {
    expect(
      toRunOverrides({ max_context_tokens: 4096, sampling: { temperature: 0.2 } }),
    ).toEqual({});
  });

  it("copies an object value through untouched, for the overrides still to come", () => {
    // interruption is already accepted by the runtime and is an OBJECT; the
    // mapper must not assume scalars.
    const acl = { enabled: true, kinds: ["ask"], max_pending: 2 };
    expect(toStartOnlyOptions({ sampling: { temperature: 0 } })).toEqual({
      sampling: { temperature: 0 },
    });
    expect(toRunOverrides({ interruption: acl })).toEqual({}); // not in the table yet
  });
});

describe("toStartOnlyOptions", () => {
  it("maps the four keys that are fixed when a run begins", () => {
    expect(
      toStartOnlyOptions({
        sampling: { temperature: 0.7 },
        compaction: { enabled: true },
        max_context_tokens: 8192,
        run_timeout_seconds: 600,
      }),
    ).toEqual({
      sampling: { temperature: 0.7 },
      compaction: { enabled: true },
      maxContextTokens: 8192,
      runTimeoutSeconds: 600,
    });
  });

  it("keeps retunable keys out", () => {
    expect(toStartOnlyOptions({ model: "x", retry_attempts: 0 })).toEqual({});
  });
});

describe("the two vocabularies", () => {
  // The consumer-side twin of loomcycle's own override parity test. A key added
  // upstream is invisible here until this literal is updated on purpose.
  it("retunable is exactly the twelve RFC DC keys", () => {
    expect([...RETUNABLE_KEYS].sort()).toEqual(
      [
        "effort",
        "inject_tool_guide",
        "max_concurrent_children",
        "max_iterations",
        "max_tokens",
        "memory_index_max_bytes",
        "memory_inject_max_tokens",
        "model",
        "provider",
        "retry_attempts",
        "tier",
        "unbounded_iterations",
      ].sort(),
    );
  });

  it("start-only is exactly the four run-start keys", () => {
    expect([...START_ONLY_KEYS].sort()).toEqual(
      ["compaction", "max_context_tokens", "run_timeout_seconds", "sampling"].sort(),
    );
  });

  it("no key belongs to both lifetimes", () => {
    const both = RETUNABLE_KEYS.filter((k) => START_ONLY_KEYS.includes(k));
    expect(both).toEqual([]);
  });
});

describe("hasOverrides", () => {
  it("is false for an empty or inherit-only overlay", () => {
    expect(hasOverrides({})).toBe(false);
    expect(hasOverrides({ effort: "" })).toBe(false);
  });
  it("is true for a meaningful zero, and for a start-only key", () => {
    expect(hasOverrides({ retry_attempts: 0 })).toBe(true);
    expect(hasOverrides({ max_context_tokens: 4096 })).toBe(true);
  });
});

describe("retunePayload", () => {
  it("names only what moved", () => {
    expect(retunePayload({ model: "a", effort: "low" }, { model: "b", effort: "low" }))
      .toEqual({ set: { model: "b" }, cleared: [] });
  });

  it("reports a cleared key separately — the wire merges and cannot un-set", () => {
    expect(retunePayload({ model: "a" }, {})).toEqual({ set: {}, cleared: ["model"] });
  });

  it("sees a change to zero as movement, not as a clear", () => {
    expect(retunePayload({ retry_attempts: 3 }, { retry_attempts: 0 })).toEqual({
      set: { retryAttempts: 0 },
      cleared: [],
    });
  });

  it("is empty when nothing moved", () => {
    const same = { model: "a", max_tokens: 10 };
    expect(retunePayload(same, { ...same })).toEqual({ set: {}, cleared: [] });
  });

  it("ignores start-only keys, which a retune cannot carry", () => {
    expect(retunePayload({ max_context_tokens: 1 }, { max_context_tokens: 2 })).toEqual({
      set: {},
      cleared: [],
    });
  });
});
