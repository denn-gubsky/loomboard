import { describe, expect, it, vi } from "vitest";
import type { LoomcycleClient } from "@loomcycle/client";
import { workflowDataLayer } from "./workflowCanvasData";

// The host's run and channel reads (RFC CZ M3b): the SDK → canvas mapping.

const client = (o: Record<string, unknown>) =>
  ({ whoami: vi.fn(async () => ({ subject: "u-self" })), ...o }) as unknown as LoomcycleClient;

describe("workflowDataLayer — run and channel reads", () => {
  it("readRun maps a run's result, the End a walk reached, and usage (RFC DI, G14)", async () => {
    const getRun = vi.fn(async () => ({
      run_id: "r1",
      status: "completed",
      result: { final_text: "chunk_9", structured: { chunk_id: "chunk_9" }, terminal: "done" },
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
      terminal: "done",
      stopReason: "end_turn",
      model: "m",
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(d.error).toBeUndefined();
  });

  it("watchRunLines follows one run's stream into its last lines, coalescing a burst into one update", async () => {
    const frames = [
      { type: "agent", run_id: "m1", session_id: "s1" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ];
    const streamRunByID = vi.fn(async function* () {
      for (const f of frames) yield f;
    });
    const got: unknown[] = [];
    workflowDataLayer(client({ streamRunByID })).watchRunLines!("m1", (lines) => got.push(lines));
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0));
    expect(streamRunByID).toHaveBeenCalledWith("m1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // The two deltas arrived together: one update, with the whole text.
    expect(got).toEqual([[{ role: "assistant", kind: "text", text: "Hello" }]]);
  });

  it("watchRunLines stops following when told to, and does not report the abort as an error", async () => {
    let signal: AbortSignal | undefined;
    const streamRunByID = vi.fn(async function* (_id: string, o: { signal: AbortSignal }) {
      signal = o.signal;
      yield { type: "text", text: "x" };
      await new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    });
    const onError = vi.fn();
    const stop = workflowDataLayer(client({ streamRunByID })).watchRunLines!("m1", () => undefined, onError);
    await vi.waitFor(() => expect(signal).toBeDefined());
    stop();
    expect(signal!.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).not.toHaveBeenCalled();
  });

  it("readChunk finds a chunk in the user's documents, else the tenant's, and says which", async () => {
    const document = vi.fn(async (input: { scope: string; id: string }) => {
      if (input.scope === "user") throw new Error("not found");
      return { id: input.id, title: "T", body: "B", document_id: "d1", position: 0 };
    });
    const c = await workflowDataLayer(client({ document })).readChunk!("c1");
    expect(c).toEqual({ id: "c1", title: "T", body: "B", documentId: "d1", scope: "tenant" });
    expect(document.mock.calls.map((x) => x[0].scope)).toEqual(["user", "tenant"]);
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
