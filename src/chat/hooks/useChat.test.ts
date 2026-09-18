// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoomcycleClient } from "@loomcycle/client";
import { useChat } from "./useChat";
import type { ChatConversation } from "../types";

// A fake client covering only what send() reaches.
//
// The stream STAYS OPEN after parking, which is the part that matters: a real
// parked interactive run keeps its stream alive, and that is what leaves
// liveRef true and so ARMS the steer fast path for the next send. A generator
// that returned after `awaiting_input` would leave the steer permanently
// disarmed and quietly turn every steer assertion into a tautology.
function fakeClient() {
  const calls = {
    runStreaming: vi.fn(),
    continueSession: vi.fn(),
    sendRunInput: vi.fn(async () => ({ run_id: "r1", delivered: true })),
    agentDef: vi.fn(async () => ({})),
  };
  const open: Array<() => void> = [];
  async function* parked() {
    yield { type: "agent", run_id: "r1", session_id: "s1" };
    yield { type: "awaiting_input" };
    await new Promise<void>((resolve) => open.push(resolve)); // parked, still live
  }
  const client = {
    runStreaming: (o: unknown) => (calls.runStreaming(o), parked()),
    continueSession: (o: unknown) => (calls.continueSession(o), parked()),
    sendRunInput: calls.sendRunInput,
    agentDef: calls.agentDef,
  } as unknown as LoomcycleClient;
  /** Release every parked stream, so nothing is left pending at teardown. */
  const closeAll = () => open.splice(0).forEach((r) => r());
  return { client, calls, closeAll };
}

const convo = (over: Partial<ChatConversation> = {}): ChatConversation => ({
  id: "c1",
  title: "New chat",
  baseAgent: "chat/medium",
  config: {},
  ...over,
});

/** Drive the hook, letting the host apply patches the way the real app does. */
function driver(initial: ChatConversation, client: LoomcycleClient) {
  let current = initial;
  const onChange = (patch: Partial<ChatConversation>) => {
    current = { ...current, ...patch };
    rerender({ c: current });
  };
  const { result, rerender } = renderHook(
    ({ c }: { c: ChatConversation }) => useChat(client, c, onChange),
    { initialProps: { c: initial } },
  );
  return {
    result,
    send: async (t: string) => {
      await act(async () => {
        await result.current.send(t);
      });
    },
    setConfig: (config: ChatConversation["config"]) => {
      current = { ...current, config };
      act(() => rerender({ c: current }));
    },
    get conversation() {
      return current;
    },
  };
}

describe("useChat — the first send", () => {
  it("runs the BASE agent and never mints an AgentDef", async () => {
    // The fork named the agent `${base}__lb-<uuid8>` and created a def for it,
    // leaking one per custom-config chat that ever sent.
    const { client, calls } = fakeClient();
    const d = driver(convo({ config: { model: "gemma4:latest" } }), client);
    await d.send("hello");
    await waitFor(() => expect(calls.runStreaming).toHaveBeenCalled());
    expect(calls.runStreaming.mock.calls[0][0]).toMatchObject({ agent: "chat/medium" });
    expect(calls.agentDef).not.toHaveBeenCalled();
  });

  it("carries the overlay as per-run overrides", async () => {
    const { client, calls } = fakeClient();
    const d = driver(
      convo({ config: { model: "gemma4:latest", retry_attempts: 0, max_context_tokens: 4096 } }),
      client,
    );
    await d.send("hello");
    await waitFor(() => expect(calls.runStreaming).toHaveBeenCalled());
    expect(calls.runStreaming.mock.calls[0][0]).toMatchObject({
      model: "gemma4:latest",
      retryAttempts: 0, // the meaningful zero has to survive the whole path
      maxContextTokens: 4096,
    });
  });

  it("sends no override keys for a plain chat", async () => {
    const { client, calls } = fakeClient();
    const d = driver(convo(), client);
    await d.send("hello");
    await waitFor(() => expect(calls.runStreaming).toHaveBeenCalled());
    const opts = calls.runStreaming.mock.calls[0][0] as Record<string, unknown>;
    expect("model" in opts).toBe(false);
    expect("maxTokens" in opts).toBe(false);
  });
});

describe("useChat — a settings change mid-conversation", () => {
  // THE HEADLINE DEFECT. The fork was minted once and never regenerated, and the
  // continue path never re-resolved an agent, so every edit after the first send
  // was silently discarded — the panel stayed editable and said nothing.
  it("reaches the next turn", async () => {
    const { client, calls } = fakeClient();
    const d = driver(convo({ sessionId: "s1" }), client);
    await d.send("first");
    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(1));

    d.setConfig({ model: "claude-sonnet-5" });
    await d.send("second");

    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(2));
    expect(calls.continueSession.mock.calls[1][0]).toMatchObject({
      model: "claude-sonnet-5",
    });
  });

  it("takes the segments path rather than a steer, which cannot carry a retune", async () => {
    const { client, calls, closeAll } = fakeClient();
    const d = driver(convo({ sessionId: "s1" }), client);
    await d.send("first");
    // The run is parked and its stream is still open, so the steer IS armed —
    // without that this assertion would pass for the wrong reason.
    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(1));

    d.setConfig({ effort: "high" });
    await d.send("second");

    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(2));
    expect(calls.sendRunInput).not.toHaveBeenCalled();
    closeAll();
  });

  it("still takes the cheap steer when nothing moved", async () => {
    const { client, calls, closeAll } = fakeClient();
    const d = driver(convo({ sessionId: "s1", config: { effort: "low" } }), client);
    await d.send("first");
    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(1));

    await d.send("second"); // same overlay
    await waitFor(() => expect(calls.sendRunInput).toHaveBeenCalledTimes(1));
    expect(calls.continueSession).toHaveBeenCalledTimes(1); // no new run
    closeAll();
  });

  it("re-asserts the overlay on every new run, since overrides live with the run", async () => {
    const { client, calls } = fakeClient();
    const d = driver(convo({ sessionId: "s1", config: { effort: "low" } }), client);
    await d.send("first");
    await waitFor(() => expect(calls.continueSession).toHaveBeenCalledTimes(1));
    expect(calls.continueSession.mock.calls[0][0]).toMatchObject({ effort: "low" });
  });
});
