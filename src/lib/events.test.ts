import { describe, it, expect } from "vitest";
import type { TranscriptResponse } from "@loomcycle/client";
import { optionsToArray, transcriptToEvents } from "./events";

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

describe("transcriptToEvents", () => {
  it("rebuilds a turn sequence: skips system_prompt, extracts user_input text, passes events through", () => {
    const t: TranscriptResponse = {
      session: { id: "s1", user_id: "u", agent: "chat", created_at: "" },
      events: [
        { seq: 0, run_id: "r1", ts_ns: 0, type: "system_prompt", payload: { system_prompt: "..." } },
        {
          seq: 1,
          run_id: "r1",
          ts_ns: 1,
          type: "user_input",
          payload: [{ role: "user", content: [{ type: "trusted-text", text: "hello" }] }],
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
});
