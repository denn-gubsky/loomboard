import { describe, expect, it, vi } from "vitest";
import type { LoomcycleClient } from "@loomcycle/client";
import { workflowDataLayer } from "./workflowCanvasData";

// The host's run and channel reads (RFC CZ M3b): the SDK → canvas mapping.

const client = (o: Record<string, unknown>) =>
  ({ whoami: vi.fn(async () => ({ subject: "u-self" })), ...o }) as unknown as LoomcycleClient;

describe("workflowDataLayer — run and channel reads", () => {
  it("readRun maps a run's result and usage (RFC DI)", async () => {
    const getRun = vi.fn(async () => ({
      run_id: "r1",
      status: "completed",
      result: { final_text: "chunk_9", structured: { chunk_id: "chunk_9" } },
      error: null,
      stop_reason: "end_turn",
      started_at: "2026-10-01T10:00:00Z",
      completed_at: "2026-10-01T10:01:00Z",
      usage: { model: "m", input_tokens: 12, output_tokens: 3 },
    }));
    const d = await workflowDataLayer(client({ getRun })).readRun!("r1");
    expect(getRun).toHaveBeenCalledWith("r1");
    expect(d).toMatchObject({
      runId: "r1",
      status: "completed",
      finalText: "chunk_9",
      structured: { chunk_id: "chunk_9" },
      stopReason: "end_turn",
      model: "m",
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(d.error).toBeUndefined();
  });

  it("readRunPrompt flattens text blocks and NAMES an image rather than dropping it", async () => {
    const getRunPrompt = vi.fn(async () => ({
      run_id: "r1",
      system: [{ type: "text", text: "A" }, { type: "text", text: "B" }],
      input: [{ type: "text", text: "Q" }, { type: "image", media_type: "image/png" }],
    }));
    const p = await workflowDataLayer(client({ getRunPrompt })).readRunPrompt!("r1");
    expect(p.system).toBe("A\n\nB");
    expect(p.input).toBe("Q\n\n[image image/png]");
  });

  it("peekChannel passes the channel's declared scope, and the caller's id for a user channel", async () => {
    const peekChannel = vi.fn(async () => ({
      channel: "out",
      messages: [{ id: "m1", value: { output: "x" }, published_at: "2026-10-01T10:00:00Z" }],
    }));
    const layer = workflowDataLayer(client({ peekChannel }));
    const msgs = await layer.peekChannel!("out", { scope: "user", max: 50 });
    expect(peekChannel).toHaveBeenCalledWith("out", { scope: "user", maxMessages: 50, userId: "u-self" });
    expect(msgs).toEqual([{ id: "m1", publishedAt: "2026-10-01T10:00:00Z", value: { output: "x" } }]);

    await layer.peekChannel!("out", { scope: "global" });
    expect(peekChannel).toHaveBeenLastCalledWith("out", { scope: "global", maxMessages: undefined });
  });

  it("lists documents and chunks for the Input node's pickers through the Document tool", async () => {
    const document = vi.fn(async (input: { op: string }) =>
      input.op === "query_documents"
        ? { documents: [{ document_id: "doc1", title: "PC Parts Catalog", root_chunk_id: "root" }] }
        : { chunks: [{ id: "c1", document_id: "doc1", title: "Ryzen", position: 0, revision: 1, parent_id: "root" }] },
    );
    const layer = workflowDataLayer(client({ document }));
    expect(await layer.listDocuments!({ scope: "user", underPath: "/loomboard/tests" })).toEqual([{ id: "doc1", title: "PC Parts Catalog" }]);
    expect(document).toHaveBeenLastCalledWith({ op: "query_documents", scope: "user", under_path: "/loomboard/tests" });
    expect(await layer.listChunks!("doc1", { scope: "user" })).toEqual([{ id: "c1", title: "Ryzen", position: 0, parent_id: "root" }]);
    expect(document).toHaveBeenLastCalledWith({ op: "query_chunks", scope: "user", document_id: "doc1" });
  });
});
