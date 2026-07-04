import { describe, it, expect } from "vitest";
import {
  chatReducer,
  initialChatState,
  type AssistantMessage,
  type ChatState,
  type MessagePart,
} from "./eventReducer";
import type { ChatEvent } from "./events";

// Fold a sequence of stream events through the reducer.
function run(events: ChatEvent[], state: ChatState = initialChatState): ChatState {
  return events.reduce((s, event) => chatReducer(s, { kind: "event", event }), state);
}

const ev = (type: string, extra: Partial<ChatEvent> = {}): ChatEvent =>
  ({ type, ...extra }) as ChatEvent;

function assistant(state: ChatState, i: number): AssistantMessage {
  const m = state.messages[i];
  if (m.role !== "assistant") throw new Error(`message ${i} is not assistant`);
  return m;
}

describe("chatReducer — text", () => {
  it("accumulates text deltas into a single text part", () => {
    const s = run([ev("text", { text: "Hel" }), ev("text", { text: "lo" }), ev("done", { stop_reason: "end_turn" })]);
    expect(s.messages).toHaveLength(1);
    const a = assistant(s, 0);
    expect(a.parts).toEqual<MessagePart[]>([{ type: "text", text: "Hello" }]);
    expect(a.status).toBe("done");
    expect(a.stopReason).toBe("end_turn");
  });

  it("starts a new assistant message after done", () => {
    const s = run([
      ev("text", { text: "first" }),
      ev("done"),
      ev("text", { text: "second" }),
    ]);
    expect(s.messages).toHaveLength(2);
    expect(assistant(s, 0).status).toBe("done");
    expect(assistant(s, 1).status).toBe("streaming");
  });
});

describe("chatReducer — thinking", () => {
  it("accumulates thinking separately from text and preserves order", () => {
    const s = run([
      ev("thinking", { text: "hmm" }),
      ev("thinking", { text: "..." }),
      ev("text", { text: "answer" }),
    ]);
    expect(assistant(s, 0).parts).toEqual<MessagePart[]>([
      { type: "thinking", text: "hmm..." },
      { type: "text", text: "answer" },
    ]);
  });

  it("surfaces done.reasoning as a thinking part when none streamed", () => {
    const s = run([ev("text", { text: "answer" }), ev("done", { reasoning: "because X" })]);
    expect(assistant(s, 0).parts).toEqual<MessagePart[]>([
      { type: "thinking", text: "because X" },
      { type: "text", text: "answer" },
    ]);
  });
});

describe("chatReducer — thinking duration", () => {
  it("stamps the duration onto the active thinking part", () => {
    let s = run([ev("thinking", { text: "let me think" })]);
    s = chatReducer(s, { kind: "thinkingDuration", ms: 3200 });
    const tp = assistant(s, 0).parts.find((p) => p.type === "thinking");
    expect(tp).toMatchObject({ type: "thinking", text: "let me think", durationMs: 3200 });
  });

  it("stamps each thinking phase's own duration (most-recent un-stamped)", () => {
    let s = run([ev("thinking", { text: "first" })]);
    s = chatReducer(s, { kind: "thinkingDuration", ms: 1000 });
    s = run(
      [ev("tool_call", { tool_use: { id: "a", name: "x", input: {} } }), ev("thinking", { text: "second" })],
      s,
    );
    s = chatReducer(s, { kind: "thinkingDuration", ms: 2000 });
    const thinks = assistant(s, 0).parts.filter((p) => p.type === "thinking");
    expect(thinks).toHaveLength(2);
    expect(thinks[0]).toMatchObject({ durationMs: 1000 });
    expect(thinks[1]).toMatchObject({ durationMs: 2000 });
  });
});

describe("chatReducer — tools", () => {
  it("pairs tool_result with the matching tool_call (FIFO) and interleaves with text", () => {
    const s = run([
      ev("text", { text: "let me check" }),
      ev("tool_call", { tool_use: { id: "a", name: "search", input: { q: "x" } } }),
      ev("tool_call", { tool_use: { id: "b", name: "read", input: { f: "y" } } }),
      ev("tool_result", { text: "search result" }),
      ev("tool_result", { text: "read result", is_error: true }),
      ev("text", { text: "done" }),
    ]);
    const parts = assistant(s, 0).parts;
    expect(parts[0]).toEqual({ type: "text", text: "let me check" });
    expect(parts[1]).toEqual({ type: "tool", call: { id: "a", name: "search", input: { q: "x" }, result: "search result", isError: undefined } });
    expect(parts[2]).toEqual({ type: "tool", call: { id: "b", name: "read", input: { f: "y" }, result: "read result", isError: true } });
    expect(parts[3]).toEqual({ type: "text", text: "done" });
  });
});

describe("chatReducer — usage metrics", () => {
  it("folds usage events into metrics", () => {
    const s = run([
      ev("usage", { usage: { input_tokens: 100, output_tokens: 20, max_context_tokens: 200000 } }),
      ev("usage", { usage: { input_tokens: 250, output_tokens: 40 } }),
    ]);
    expect(s.metrics.inputTokens).toBe(350);
    expect(s.metrics.outputTokens).toBe(60);
    expect(s.metrics.contextTokens).toBe(290);
    expect(s.metrics.maxContextTokens).toBe(200000);
  });
});

describe("chatReducer — interrupts", () => {
  it("sets and clears the pending interrupt", () => {
    let s = run([
      ev("interruption_pending", {
        interruption: { interrupt_id: "intr_1", kind: "question", question: "Proceed?", options: ["yes", "no"] },
      }),
    ]);
    expect(s.pendingInterrupt?.interrupt_id).toBe("intr_1");
    expect(s.pendingInterrupt?.question).toBe("Proceed?");
    s = chatReducer(s, { kind: "clearInterrupt" });
    expect(s.pendingInterrupt).toBeNull();
  });
});

describe("chatReducer — user turns and multi-turn replay", () => {
  it("user action closes the open assistant and appends a user message", () => {
    let s = run([ev("text", { text: "hi" })]);
    s = chatReducer(s, { kind: "user", text: "next question" });
    expect(s.messages).toHaveLength(2);
    expect(assistant(s, 0).status).toBe("done");
    expect(s.messages[1]).toEqual({ role: "user", text: "next question" });
  });

  it("rebuilds a multi-turn transcript from replayed events", () => {
    const s = run([
      ev("user_input", { user_input: { text: "q1" } }),
      ev("text", { text: "a1" }),
      ev("done"),
      ev("user_input", { user_input: { text: "q2" } }),
      ev("text", { text: "a2" }),
      ev("done"),
    ]);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(s.messages[0]).toEqual({ role: "user", text: "q1" });
    expect(assistant(s, 3).parts).toEqual<MessagePart[]>([{ type: "text", text: "a2" }]);
  });

  it("ignores ALL steer frames — live echoes and replays alike", () => {
    // Live steers (source api/webui/none) echo the optimistic add; replay steers
    // flatten the role:system system prompt with no role to filter on. None are
    // rendered — user turns come from the optimistic add (live) or role-filtered
    // user_input (reload).
    for (const source of ["api", "webui", "replay", undefined]) {
      const s = run([ev("steer", { user_input: { text: "x", source } })]);
      expect(s.messages).toEqual([]);
    }
  });

  it("does not duplicate a live turn: optimistic user add + the steer echo", () => {
    let s = chatReducer(initialChatState, { kind: "user", text: "hi there" });
    // The live run drains the steer and echoes it back on the same stream.
    s = chatReducer(s, {
      kind: "event",
      event: ev("steer", { user_input: { text: "hi there", source: "api" } }),
    });
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });
});

describe("chatReducer — lifecycle", () => {
  it("captures run and session ids from the agent frame", () => {
    const s = run([ev("agent", { run_id: "run_1", session_id: "sess_1", agent_id: "run_1" })]);
    expect(s.runId).toBe("run_1");
    expect(s.sessionId).toBe("sess_1");
  });

  it("marks awaiting_input and closes the open turn", () => {
    const s = run([ev("text", { text: "parked answer" }), ev("done"), ev("awaiting_input", { awaiting_input: { since_turn: 1 } })]);
    expect(s.awaitingInput).toBe(true);
    expect(assistant(s, 0).status).toBe("done");
  });

  it("finalizes an open turn as error", () => {
    const s = run([ev("text", { text: "partial" }), ev("error", { error: "boom" })]);
    const a = assistant(s, 0);
    expect(a.status).toBe("error");
    expect(a.error).toBe("boom");
  });

  it("emits a standalone error message when no turn is open", () => {
    const s = run([ev("error", { error: "early failure" })]);
    expect(s.messages).toHaveLength(1);
    expect(assistant(s, 0)).toMatchObject({ status: "error", error: "early failure", parts: [] });
  });
});

describe("chatReducer — serving model & provider fallback", () => {
  it("captures the serving provider/model from usage", () => {
    const s = run([
      ev("usage", {
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          model: "deepseek-v4-flash",
          provider: "deepseek",
        },
      } as unknown as Partial<ChatEvent>),
    ]);
    expect(s.servingModel).toBe("deepseek-v4-flash");
    expect(s.servingProvider).toBe("deepseek");
  });

  it("renders provider_fallback inline and updates the serving model", () => {
    const s = run([
      ev("text", { text: "working" }),
      ev("provider_fallback", {
        fallback: {
          failed_provider: "ollama-local",
          failed_model: "gemma4:latest",
          new_provider: "deepseek",
          new_model: "deepseek-v4-flash",
          reason: "UNAVAILABLE",
        },
      }),
    ]);
    expect(s.servingModel).toBe("deepseek-v4-flash");
    expect(s.servingProvider).toBe("deepseek");
    const notice = assistant(s, 0).parts.find((p) => p.type === "notice");
    expect(notice).toBeTruthy();
    if (notice && notice.type === "notice") {
      expect(notice.level).toBe("warn");
      expect(notice.text).toContain("ollama-local/gemma4:latest");
      expect(notice.text).toContain("deepseek/deepseek-v4-flash");
    }
  });
});

describe("chatReducer — reset", () => {
  it("resets to initial, optionally seeding ids", () => {
    const dirty = run([ev("text", { text: "stuff" }), ev("usage", { usage: { input_tokens: 5, output_tokens: 5 } })]);
    const s = chatReducer(dirty, { kind: "reset", seed: { sessionId: "sess_x", runId: "run_x" } });
    expect(s.messages).toEqual([]);
    expect(s.metrics.inputTokens).toBe(0);
    expect(s.sessionId).toBe("sess_x");
    expect(s.runId).toBe("run_x");
  });
});
