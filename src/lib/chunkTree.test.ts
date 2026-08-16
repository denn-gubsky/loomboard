import { describe, it, expect } from "vitest";
import { buildChunkTree } from "./chunkTree";
import type { ChunkRow } from "./workflowApi";

function c(id: string, position: number, parent_id?: string, status?: string): ChunkRow {
  return { id, document_id: "d", title: id, position, revision: 1, parent_id, status };
}

describe("buildChunkTree", () => {
  it("nests children under parents, ordered by position", () => {
    // root -> [steps, preamble]; steps -> [task-b, task-a]
    const chunks = [
      c("preamble", 1, "root"),
      c("steps", 0, "root"),
      c("task-a", 1, "steps"),
      c("task-b", 0, "steps"),
    ];
    const tree = buildChunkTree(chunks, "root");
    expect(tree.map((n) => n.chunk.id)).toEqual(["steps", "preamble"]); // by position
    const steps = tree[0];
    expect(steps.children.map((n) => n.chunk.id)).toEqual(["task-b", "task-a"]);
    expect(tree[1].children).toEqual([]);
  });

  it("treats chunks parented to the doc root (or unparented) as top-level", () => {
    const tree = buildChunkTree([c("x", 0, "root"), c("y", 1)], "root");
    expect(tree.map((n) => n.chunk.id)).toEqual(["x", "y"]);
  });

  it("orphans (missing parent) fall back to top-level", () => {
    const tree = buildChunkTree([c("orphan", 0, "gone")], "root");
    expect(tree.map((n) => n.chunk.id)).toEqual(["orphan"]);
  });
});
