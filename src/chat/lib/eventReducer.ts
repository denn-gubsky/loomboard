import type { TranscriptResponse } from "@loomcycle/client";
import {
  accumulateUsage,
  emptyMetrics,
  formatCount,
  type TokenMetrics,
} from "./metrics";
import {
  describeFallback,
  describeDistill,
  describeDistillDeclined,
  describeLimit,
  describeOverride,
  shouldPostOverride,
  transcriptToEvents,
  type ChatEvent,
  type InterruptionInfo,
} from "./events";
import type { SentAttachment } from "./attachments";

// ---- View model ----

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Tool output, once the matching tool_result arrives. */
  result?: string;
  isError?: boolean;
}

// An assistant turn is an ordered list of parts so text, thinking, and tool
// calls render in the order they streamed (interleaving matters: "let me
// search" → [tool] → "found it").
export type MessagePart =
  | { type: "text"; text: string }
  // durationMs is set once the reasoning phase ends (Open-WebUI-style
  // "Thought for N s"); undefined while still thinking.
  | { type: "thinking"; text: string; durationMs?: number }
  | { type: "tool"; call: ToolCall }
  // Inline runtime notice (provider fallback, token-budget crossing) shown
  // where it happened. "error" = a hard stop (e.g. hard token budget reached).
  | { type: "notice"; level: "warn" | "info" | "error"; text: string };

export interface UserMessage {
  role: "user";
  text: string;
  /** Attachments shown with the message (live send only; transcript reload
   *  rebuilds text but not thumbnails). */
  attachments?: SentAttachment[];
}

export interface AssistantMessage {
  role: "assistant";
  parts: MessagePart[];
  status: "streaming" | "done" | "error";
  stopReason?: string;
  error?: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface ChatState {
  messages: ChatMessage[];
  metrics: TokenMetrics;
  pendingInterrupt: InterruptionInfo | null;
  /** True when the run has parked at end_turn (interactive, ready for input). */
  awaitingInput: boolean;
  /** The provider/model actually serving the run, from usage events. This is the
   *  truth a config override is checked against — it reflects any fallback. */
  servingModel: string | null;
  servingProvider: string | null;
  runId: string | null;
  sessionId: string | null;
}

export const initialChatState: ChatState = {
  messages: [],
  metrics: emptyMetrics,
  pendingInterrupt: null,
  awaitingInput: false,
  servingModel: null,
  servingProvider: null,
  runId: null,
  sessionId: null,
};

export type ChatAction =
  | { kind: "event"; event: ChatEvent }
  | { kind: "user"; text: string; attachments?: SentAttachment[] }
  | { kind: "thinkingDuration"; ms: number }
  | { kind: "clearInterrupt" }
  | { kind: "turnStopped" }
  | { kind: "compacted"; before: number; after: number }
  | { kind: "reset"; seed?: Partial<ChatState> };

// ---- Pure helpers over the message list ----

function openAssistant(messages: ChatMessage[]): AssistantMessage | null {
  const last = messages[messages.length - 1];
  return last && last.role === "assistant" && last.status === "streaming"
    ? last
    : null;
}

/** Apply `update` to the open (streaming) assistant message, creating a fresh
 *  one if none is open. The open message is always the last element. */
function updateOpenAssistant(
  messages: ChatMessage[],
  update: (m: AssistantMessage) => AssistantMessage,
): ChatMessage[] {
  const open = openAssistant(messages);
  if (open) {
    const next = messages.slice();
    next[next.length - 1] = update(open);
    return next;
  }
  const fresh: AssistantMessage = { role: "assistant", parts: [], status: "streaming" };
  return [...messages, update(fresh)];
}

/** Post a notice into the transcript, whether or not a turn is streaming.
 *
 *  Neither existing pattern is right for an event that can arrive at either
 *  moment. `updateOpenAssistant` alone (what `limit` and `provider_fallback` do)
 *  FABRICATES a streaming bubble when nothing is open, and nothing ever closes
 *  it. An unconditional `closeOpen` + append (what `compacted` does) is wrong the
 *  other way: it would end a turn that is still generating. So: join the open
 *  turn when there is one, and stand alone when there is not. */
function postNotice(
  messages: ChatMessage[],
  level: "warn" | "info" | "error",
  text: string,
): ChatMessage[] {
  if (openAssistant(messages)) {
    return updateOpenAssistant(messages, (m) => addNotice(m, level, text));
  }
  return [
    ...messages,
    { role: "assistant", status: "done", parts: [{ type: "notice", level, text }] },
  ];
}

/** Mark the open assistant message done (no-op if none open). */
function closeOpen(messages: ChatMessage[]): ChatMessage[] {
  const open = openAssistant(messages);
  if (!open) return messages;
  const next = messages.slice();
  next[next.length - 1] = { ...open, status: "done" };
  return next;
}

function appendDelta(
  m: AssistantMessage,
  kind: "text" | "thinking",
  text: string,
): AssistantMessage {
  if (!text) return m;
  const parts = m.parts.slice();
  const last = parts[parts.length - 1];
  if (last && last.type === kind) {
    parts[parts.length - 1] = { type: kind, text: last.text + text };
  } else {
    parts.push({ type: kind, text });
  }
  return { ...m, parts };
}

function addTool(m: AssistantMessage, call: ToolCall): AssistantMessage {
  return { ...m, parts: [...m.parts, { type: "tool", call }] };
}

function addNotice(
  m: AssistantMessage,
  level: "warn" | "info" | "error",
  text: string,
): AssistantMessage {
  return { ...m, parts: [...m.parts, { type: "notice", level, text }] };
}

/** Attach a tool_result to the FIRST tool call still awaiting one — results
 *  arrive in call order, so FIFO matching is correct. */
function attachToolResult(
  m: AssistantMessage,
  result: string,
  isError: boolean | undefined,
): AssistantMessage {
  const parts = m.parts.slice();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === "tool" && p.call.result === undefined) {
      parts[i] = { type: "tool", call: { ...p.call, result, isError } };
      return { ...m, parts };
    }
  }
  return m;
}

function pushUser(
  messages: ChatMessage[],
  text: string,
  attachments?: SentAttachment[],
): ChatMessage[] {
  return [...closeOpen(messages), { role: "user", text, attachments }];
}

/** Stamp the reasoning duration onto the open assistant's most recent
 *  still-active (durationMs-less) thinking part — marking that the model
 *  finished thinking and started answering. */
function stampThinkingDuration(messages: ChatMessage[], ms: number): ChatMessage[] {
  const open = openAssistant(messages);
  if (!open) return messages;
  const parts = open.parts.slice();
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "thinking" && p.durationMs === undefined) {
      parts[i] = { ...p, durationMs: ms };
      const next = messages.slice();
      next[next.length - 1] = { ...open, parts };
      return next;
    }
  }
  return messages;
}

// ---- Reducer ----

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.kind) {
    case "reset":
      return { ...initialChatState, ...action.seed };
    case "clearInterrupt":
      return { ...state, pendingInterrupt: null };
    case "turnStopped":
      // Operator stopped the current turn (RFC BH cancelTurn): the run parks at
      // awaiting_input with the session intact — so we drop any pending
      // question, mark it parked (ready for the next message / compaction), and
      // note it in the transcript.
      return {
        ...state,
        pendingInterrupt: null,
        awaitingInput: true,
        messages: [
          ...closeOpen(state.messages),
          {
            role: "assistant",
            status: "done",
            parts: [{ type: "notice", level: "info", text: "Stopped." }],
          },
        ],
      };
    case "compacted":
      // Compaction summarized the parked run's context. Post the before→after
      // result as a transcript notice, and set contextTokens to the new
      // footprint so the HUD gauge updates now instead of staying stale until
      // the next turn's usage event.
      return {
        ...state,
        messages: [
          ...closeOpen(state.messages),
          {
            role: "assistant",
            status: "done",
            parts: [
              {
                type: "notice",
                level: "info",
                text: `Context compacted: ${formatCount(action.before)} → ${formatCount(action.after)} tokens`,
              },
            ],
          },
        ],
        metrics: { ...state.metrics, contextTokens: action.after },
      };
    case "user":
      return {
        ...state,
        awaitingInput: false,
        messages: pushUser(state.messages, action.text, action.attachments),
      };
    case "thinkingDuration":
      return {
        ...state,
        messages: stampThinkingDuration(state.messages, action.ms),
      };
    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: ChatState, ev: ChatEvent): ChatState {
  switch (ev.type) {
    case "agent":
    case "session":
      return {
        ...state,
        runId: ev.run_id ?? ev.agent_id ?? state.runId,
        sessionId: ev.session_id ?? state.sessionId,
      };

    case "text":
      return {
        ...state,
        awaitingInput: false,
        messages: updateOpenAssistant(state.messages, (m) =>
          appendDelta(m, "text", ev.text ?? ""),
        ),
      };

    case "thinking":
      return {
        ...state,
        awaitingInput: false,
        messages: updateOpenAssistant(state.messages, (m) =>
          appendDelta(m, "thinking", ev.text ?? ""),
        ),
      };

    case "tool_call":
      if (!ev.tool_use) return state;
      return {
        ...state,
        awaitingInput: false,
        messages: updateOpenAssistant(state.messages, (m) =>
          addTool(m, {
            id: ev.tool_use!.id,
            name: ev.tool_use!.name,
            input: ev.tool_use!.input,
          }),
        ),
      };

    case "tool_result":
      return {
        ...state,
        messages: updateOpenAssistant(state.messages, (m) =>
          attachToolResult(m, ev.text ?? "", ev.is_error),
        ),
      };

    case "usage":
      if (!ev.usage) return state;
      return {
        ...state,
        metrics: accumulateUsage(state.metrics, ev.usage),
        servingModel: ev.usage.model ?? state.servingModel,
        // The SDK's Usage type omits `provider`, but the wire includes the
        // provider that actually served the call.
        servingProvider:
          (ev.usage as { provider?: string }).provider ?? state.servingProvider,
      };

    case "provider_fallback":
      // Surface the switch inline so an override that failed over is visible.
      return ev.fallback
        ? {
            ...state,
            servingModel: ev.fallback.new_model ?? state.servingModel,
            servingProvider: ev.fallback.new_provider ?? state.servingProvider,
            messages: updateOpenAssistant(state.messages, (m) =>
              addNotice(m, "warn", describeFallback(ev.fallback!)),
            ),
          }
        : state;

    case "limit":
      // Token-budget crossing (RFC AW). Surface inline where it happened: a
      // soft crossing warns (run continues); a hard crossing is an error (the
      // budget is reached, further runs are blocked at admission).
      if (!ev.limit) return state;
      return {
        ...state,
        messages: updateOpenAssistant(state.messages, (m) =>
          addNotice(m, ev.limit!.severity === "hard" ? "error" : "warn", describeLimit(ev.limit!)),
        ),
      };

    case "context_compaction":
    case "context_recap": {
      // The runtime distilled the working context. Until now these fell through
      // `default:` and the user saw nothing at all — no note, no metric move —
      // so "it never compacted" and "it compacted and barely helped" looked
      // identical from the chat, which is how a conversation reached the top of
      // its window with nobody able to say whether anything had tried.
      const d = ev.type === "context_recap" ? ev.context_recap : ev.context_compaction;
      if (!d) return state;
      const kind = ev.type === "context_recap" ? "recap" : "compaction";
      return {
        ...state,
        // The gauge would otherwise stay stale until the next turn's usage
        // event, showing a full window that is no longer full.
        metrics:
          typeof d.after_tokens === "number"
            ? { ...state.metrics, contextTokens: d.after_tokens }
            : state.metrics,
        messages: postNotice(state.messages, "info", describeDistill(kind, d)),
      };
    }

    case "context_distill_declined": {
      // The runtime crossed its threshold and then did nothing. Without this
      // the transcript could not distinguish "it never tried" from "it tried
      // and could not" — which is how a conversation reached the top of its
      // window with the reason sitting unreported on the server the whole time.
      //
      // Warn, not info: a distillation that declines at 99% is a run about to
      // fail, and it is the one notice here the reader has to act on.
      if (!ev.context_distill) return state;
      return {
        ...state,
        messages: postNotice(
          state.messages,
          "warn",
          describeDistillDeclined(ev.context_distill),
        ),
      };
    }

    case "override": {
      // RFC DC: an operator retuned this run mid-flight. Post it where it
      // happened — a settings change is exactly the context someone needs when
      // the answers change character partway down a transcript.
      //
      // A ROUTING retune produces TWO frames — the operator's request, then the
      // routing the run adopted — so shouldPostOverride decides which of them
      // earns a line. See its comment for why a routing-only request is left to
      // its outcome while a budget change is not.
      if (!ev.override || !shouldPostOverride(ev.override)) return state;
      return {
        ...state,
        messages: postNotice(state.messages, "info", describeOverride(ev.override)),
      };
    }

    case "interruption_pending":
      return { ...state, pendingInterrupt: ev.interruption ?? null };

    case "awaiting_input":
      return { ...state, awaitingInput: true, messages: closeOpen(state.messages) };

    case "user_input":
      return {
        ...state,
        messages: pushUser(state.messages, ev.user_input?.text ?? ev.text ?? ""),
      };

    case "steer":
      // Never render steer frames. A LIVE steer echoes the optimistic user add
      // (→ duplicate), and loomcycle's interactive/re-attach replay synthesizes
      // steer(source="replay") frames from stored user_input rows — which
      // FLATTEN the role:system system prompt into the text, with no role to
      // filter on. User turns come from the optimistic add (live) or from
      // role-filtered user_input events (reload via getTranscript).
      return state;

    case "done":
      return { ...state, messages: finalize(state.messages, "done", ev.stop_reason, ev.reasoning) };

    case "error":
      return { ...state, messages: finalizeError(state.messages, ev.error ?? "error") };

    // started, retry, host_widened, channel_*, spawn_*, _meta — not rendered
    // as messages.
    default:
      return state;
  }
}

function finalize(
  messages: ChatMessage[],
  status: "done" | "error",
  stopReason: string | undefined,
  reasoning: string | undefined,
): ChatMessage[] {
  const open = openAssistant(messages);
  if (!open) return messages;
  let m: AssistantMessage = open;
  // Some providers only deliver the reasoning trace at done — surface it as a
  // thinking part if we didn't stream one.
  if (reasoning && !m.parts.some((p) => p.type === "thinking")) {
    m = { ...m, parts: [{ type: "thinking", text: reasoning }, ...m.parts] };
  }
  m = { ...m, status, stopReason };
  const next = messages.slice();
  next[next.length - 1] = m;
  return next;
}

function finalizeError(messages: ChatMessage[], error: string): ChatMessage[] {
  const open = openAssistant(messages);
  if (open) {
    const next = messages.slice();
    next[next.length - 1] = { ...open, status: "error", error };
    return next;
  }
  return [...messages, { role: "assistant", parts: [], status: "error", error }];
}

/** Fold a fetched transcript straight into the message view model, reusing the
 *  exact live-stream path (transcriptToEvents → the reducer). For read-only
 *  consumers (e.g. a compact tile preview) that want messages without running a
 *  full <Chat>. Pure. */
export function foldTranscript(t: TranscriptResponse): ChatMessage[] {
  let state = initialChatState;
  for (const event of transcriptToEvents(t)) {
    state = chatReducer(state, { kind: "event", event });
  }
  return state.messages;
}
