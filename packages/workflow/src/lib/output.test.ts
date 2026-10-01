import { describe, expect, it } from "vitest";
import { channelNodes } from "./channelNodes";
import { fromDefinition } from "./model";
import { latestMessages, messageText, outputChannels } from "./output";

describe("outputChannels — derived, not configured", () => {
  const m = fromDefinition({
    entry: "research",
    states: [
      { state: "research", handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "r", max: 2 }, sink: { channel: "mid" } } },
      { state: "edit", handler: { kind: "starter", source: { channel: "mid" }, fanout: { agent: "e", max: 2 }, sink: { channel: "out" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [],
  });

  it("is what the team publishes to and does not itself read", () => {
    expect(outputChannels(channelNodes(m)).map((v) => v.channel)).toEqual(["out"]);
  });

  it("excludes the input (read, not written) and internal wiring (both)", () => {
    const names = outputChannels(channelNodes(m)).map((v) => v.channel);
    expect(names).not.toContain("in");
    expect(names).not.toContain("mid");
  });
});

describe("messageText", () => {
  it("lifts a member's answer out of a sink envelope, keeping status and run", () => {
    expect(messageText({ status: "ok", run_id: "r1", output: "chunk_abc" })).toEqual({
      text: "chunk_abc",
      status: "ok",
      runId: "r1",
    });
  });

  it("shows anything else as the JSON it is", () => {
    expect(messageText({ a: 1 }).text).toBe('{\n  "a": 1\n}');
    expect(messageText("plain").text).toBe("plain");
  });

  it("never interprets markup — it returns text, which the panel renders as text", () => {
    const html = "<img src=x onerror=alert(1)>";
    expect(messageText({ output: html }).text).toBe(html);
  });
});

describe("latestMessages", () => {
  it("orders newest first and caps the count", () => {
    const msgs = ["10:00", "10:02", "10:01"].map((t, i) => ({ id: `m${i}`, publishedAt: `2026-10-01T${t}:00Z`, value: i }));
    expect(latestMessages(msgs, 2).map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
