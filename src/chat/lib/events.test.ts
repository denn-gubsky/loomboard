import { describe, it, expect } from "vitest";
import type { TranscriptResponse } from "@loomcycle/client";
import { shouldPostOverride, describeOverride, lastSeqForRun, optionsToArray, transcriptToEvents } from "./events";

describe("optionsToArray", () => {
  it("passes through a string array", () => {
    expect(optionsToArray(["yes", "no"])).toEqual(["yes", "no"]);
  });
  it("parses a JSON-encoded array string", () => {
    expect(optionsToArray('["a","b"]')).toEqual(["a", "b"]);
  });
  it("returns [] for free-text / junk", () => {
    expect(optionsToArray(undefined)).toEqual([]);
    expect(optionsToArray("not json")).toEqual([]);
    expect(optionsToArray(42)).toEqual([]);
  });
});

describe("lastSeqForRun", () => {
  const events = [
    { seq: 1, run_id: "rA", ts_ns: 0, type: "text", event: {} },
    { seq: 2, run_id: "rA", ts_ns: 0, type: "done", event: {} },
    { seq: 3, run_id: "rB", ts_ns: 0, type: "text", event: {} },
    { seq: 4, run_id: "rB", ts_ns: 0, type: "done", event: {} },
  ] as unknown as TranscriptResponse["events"];

  it("returns the max seq for the run (the tail-from point)", () => {
    expect(lastSeqForRun(events, "rA")).toBe(2);
    expect(lastSeqForRun(events, "rB")).toBe(4);
  });
  it("returns 0 for a run with no events here", () => {
    expect(lastSeqForRun(events, "rC")).toBe(0);
  });
});

describe("transcriptToEvents", () => {
  it("rebuilds a turn sequence: skips system_prompt, extracts only role:user text, passes events through", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        { seq: 0, run_id: "r1", ts_ns: 0, type: "system_prompt", payload: { system_prompt: "..." } },
        {
          seq: 1,
          run_id: "r1",
          ts_ns: 1,
          type: "user_input",
          // loomcycle stores the first turn as [system prompt, user message] —
          // only the user part must survive.
          payload: [
            { role: "system", content: [{ type: "trusted-text", text: "You are AGENT." }] },
            { role: "user", content: [{ type: "trusted-text", text: "hello" }] },
          ],
        },
        { seq: 2, run_id: "r1", ts_ns: 2, type: "text", event: { type: "text", text: "hi there" } },
        { seq: 3, run_id: "r1", ts_ns: 3, type: "done", event: { type: "done", stop_reason: "end_turn" } },
      ],
    } as unknown as TranscriptResponse;

    const events = transcriptToEvents(t);
    expect(events.map((e) => e.type)).toEqual(["user_input", "text", "done"]);
    expect(events[0].user_input?.text).toBe("hello");
    expect(events[1].text).toBe("hi there");
    expect(events[2].stop_reason).toBe("end_turn");
  });

  it("skips interruption_pending rows (live control-flow; a replayed one has a stale id)", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        { seq: 0, run_id: "r1", ts_ns: 0, type: "text", event: { type: "text", text: "hi" } },
        {
          seq: 1,
          run_id: "r1",
          ts_ns: 1,
          type: "interruption_pending",
          event: { type: "interruption_pending", interruption: { interrupt_id: "i1", kind: "question", question: "?" } },
        },
        { seq: 2, run_id: "r1", ts_ns: 2, type: "done", event: { type: "done", stop_reason: "end_turn" } },
      ],
    } as unknown as TranscriptResponse;
    expect(transcriptToEvents(t).map((e) => e.type)).toEqual(["text", "done"]);
  });

  it("skips a user_input row that has no role:user text (pure system prompt)", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        {
          seq: 0,
          run_id: "r1",
          ts_ns: 0,
          type: "user_input",
          payload: [{ role: "system", content: [{ type: "trusted-text", text: "You are AGENT." }] }],
        },
      ],
    } as unknown as TranscriptResponse;
    expect(transcriptToEvents(t)).toEqual([]);
  });
});

describe("describeOverride", () => {
  it("leads with the routing move, which is what a reader is trying to explain", () => {
    expect(
      describeOverride({ source: "operator", from_model: "ollama-local/gemma4", to_model: "anthropic/claude-sonnet-5" }),
    ).toBe("Model changed: ollama-local/gemma4 → anthropic/claude-sonnet-5");
  });

  it("handles a routing set with no previous model", () => {
    expect(describeOverride({ to_model: "openai/gpt-5" })).toBe("Model set to openai/gpt-5");
  });

  it("names the keys when the change moved no model", () => {
    expect(describeOverride({ fields: ["max_tokens", "effort"] })).toBe(
      "Run settings changed: max_tokens, effort",
    );
  });

  it("still reads sensibly when the runtime sends neither", () => {
    expect(describeOverride({})).toBe("Run settings changed");
  });

  // "operator" is the unremarkable case; anything else is worth naming.
  it("names a non-operator source only", () => {
    expect(describeOverride({ fields: ["effort"], source: "operator" })).not.toContain("by");
    expect(describeOverride({ fields: ["effort"], source: "autotuner" })).toContain(
      "(by autotuner)",
    );
  });
});

describe("shouldPostOverride", () => {
  it("always posts the adopted frame — it is the outcome", () => {
    expect(shouldPostOverride({ source: "operator", from_model: "a/1", to_model: "a/2" })).toBe(true);
  });

  it("leaves a routing-only request to the frame that reports its outcome", () => {
    expect(shouldPostOverride({ source: "operator", fields: ["model"] })).toBe(false);
    expect(shouldPostOverride({ source: "operator", fields: ["tier", "effort"] })).toBe(false);
  });

  it("posts a request touching anything routing does not cover", () => {
    // Nothing else will report it: the runtime's frame speaks for routing alone.
    expect(shouldPostOverride({ source: "operator", fields: ["max_tokens"] })).toBe(true);
    expect(shouldPostOverride({ source: "operator", fields: ["model", "retry_attempts"] })).toBe(true);
  });

  it("posts a frame that names nothing rather than staying silent", () => {
    expect(shouldPostOverride({ source: "operator" })).toBe(true);
    expect(shouldPostOverride({ source: "operator", fields: [] })).toBe(true);
  });
});
