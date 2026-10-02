import { describe, expect, it } from "vitest";
import { channelNodes } from "./channelNodes";
import { fromDefinition } from "./model";
import { latestMessages, messageText, outputChannels, walkResult } from "./output";

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

describe("walkResult", () => {
  it("lifts each agent run's answer out of a Starter's envelope, without the sub-agent marker", () => {
    // The pcparts walk's real final text (TrueNAS, 2026-10-01).
    const finalText = JSON.stringify({
      results: [
        {
          index: 0,
          agent: "marketing/article-editor",
          run_id: "r_cd39",
          ok: true,
          output: "[sub-agent agent_id=a_42844ce23e069d9b]\n4089972de02c194228a14218c28610c2",
        },
      ],
    });
    expect(walkResult(finalText)).toEqual([
      { agent: "marketing/article-editor", runId: "r_cd39", ok: true, text: "4089972de02c194228a14218c28610c2" },
    ]);
  });

  it("shows a failed run's error, and plain text as itself", () => {
    expect(walkResult(JSON.stringify({ results: [{ agent: "a", ok: false, error: "timed out" }] }))[0]).toMatchObject({ ok: false, text: "timed out" });
    expect(walkResult("the agent state's plain answer")).toEqual([{ text: "the agent state's plain answer" }]);
    expect(walkResult("")).toEqual([]);
  });

  it("drops the marker from an agent state's plain answer too — a team that ends in an agent", () => {
    // The pcparts v2 walk's real final text: its last state is an agent.
    expect(walkResult("[sub-agent agent_id=a_9471f3fa8a7c4655]\nd56c87cbbd50a67dc8a1e61e74a52720")).toEqual([
      { text: "d56c87cbbd50a67dc8a1e61e74a52720" },
    ]);
  });

  it("keeps markup as text — it is model output", () => {
    expect(walkResult('<img src=x onerror="x()">')[0].text).toBe('<img src=x onerror="x()">');
  });
});
