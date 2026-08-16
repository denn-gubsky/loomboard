import { describe, it, expect } from "vitest";
import { runsByChunk } from "./boardRuns";
import type { RunTile } from "./runStates";

function tile(runId: string, status: RunTile["status"], boardChunkId?: string): RunTile {
  return { runId, agentId: "a-" + runId, agent: "coder", status, ts: "t", boardChunkId };
}

describe("runsByChunk", () => {
  it("groups live runs by their board chunk, skipping untagged runs", () => {
    const m = runsByChunk([
      tile("r1", "running", "c1"),
      tile("r2", "running", "c1"),
      tile("r3", "running", "c2"),
      tile("r4", "running"), // untagged → excluded
    ]);
    expect(m.get("c1")!.map((t) => t.runId)).toEqual(["r1", "r2"]);
    expect(m.get("c2")!.map((t) => t.runId)).toEqual(["r3"]);
    expect(m.has("")).toBe(false);
  });

  it("keeps only live runs by default (terminal handler runs drop off the card)", () => {
    const m = runsByChunk([
      tile("r1", "completed", "c1"),
      tile("r2", "running", "c1"),
      tile("r3", "failed", "c1"),
    ]);
    expect(m.get("c1")!.map((t) => t.runId)).toEqual(["r2"]);
  });

  it("liveOnly:false includes terminal runs too", () => {
    const m = runsByChunk([tile("r1", "completed", "c1")], { liveOnly: false });
    expect(m.get("c1")!.map((t) => t.runId)).toEqual(["r1"]);
  });
});
