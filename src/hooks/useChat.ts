import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  AgentEvent,
  CompactRunResult,
  LibraryAgentDefinition,
} from "@loomcycle/client";
import { useLoomcycle } from "../state/connection";
import { useConversations, type Conversation } from "../state/conversations";
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from "../lib/eventReducer";
import { transcriptToEvents, type ChatEvent } from "../lib/events";
import { tokensPerSecond } from "../lib/metrics";
import { userSegment } from "../lib/segments";
import { resolveConversationAgent } from "../lib/agentFork";
import { describeError, isAbortError } from "../lib/loomcycle";

export interface UseChat {
  state: ChatState;
  running: boolean;
  tokensPerSec: number;
  send: (text: string) => void;
  cancel: () => void;
  compact: () => Promise<CompactRunResult | undefined>;
  resolveInterrupt: (answer: string) => Promise<void>;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 47) + "…" : t;
}

// Drives one conversation's interactive run (RFC AI). A conversation is a single
// long-lived interactive run: the first message starts it (parking at end_turn),
// follow-ups steer the SAME run via sendRunInput, and reopening re-attaches by
// run_id — or, if that run has aged out, replays the transcript read-only and
// resumes the session on the next send. The reducer is pure; this hook owns the
// stream lifecycle, wall-clock timing, and persistence of run/session ids.
export function useChat(
  conversation: Conversation | null,
  baseDef: LibraryAgentDefinition | undefined,
): UseChat {
  const client = useLoomcycle();
  const { update } = useConversations();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [running, setRunning] = useState(false);
  const [tokensPerSec, setTps] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const convoIdRef = useRef<string | null>(null);
  const runIdRef = useRef("");
  const agentIdRef = useRef("");
  // True while a run's event stream is open — only then can we steer it.
  const liveRef = useRef(false);

  const turnStartRef = useRef(0);
  const outputTokensRef = useRef(0);
  const outputAtTurnStartRef = useRef(0);

  const beginTurnTiming = useCallback(() => {
    turnStartRef.current = Date.now();
    outputAtTurnStartRef.current = outputTokensRef.current;
    setTps(0);
  }, []);

  // Consume an event stream into the reducer. `rethrowStartError` lets the
  // re-attach path detect a dead run (error before any frame) and fall back to
  // the transcript; mid-stream errors always surface as an error message.
  const consume = useCallback(
    async (
      stream: AsyncIterable<AgentEvent>,
      convoId: string,
      rethrowStartError = false,
    ) => {
      let received = 0;
      liveRef.current = true;
      try {
        for await (const ev of stream) {
          if (convoIdRef.current !== convoId) break;
          received++;
          const event = ev as ChatEvent;
          if (event.type === "agent") {
            if (event.run_id) runIdRef.current = event.run_id;
            if (event.agent_id) agentIdRef.current = event.agent_id;
          }
          dispatch({ kind: "event", event });

          if (event.type === "usage" && event.usage) {
            outputTokensRef.current += event.usage.output_tokens ?? 0;
            const elapsed = Date.now() - turnStartRef.current;
            setTps(
              tokensPerSecond(
                outputTokensRef.current - outputAtTurnStartRef.current,
                elapsed,
              ),
            );
          }
          if (
            event.type === "awaiting_input" ||
            event.type === "done" ||
            event.type === "error"
          ) {
            setRunning(false);
          }
        }
      } catch (e) {
        if (isAbortError(e)) return;
        if (rethrowStartError && received === 0) throw e;
        if (convoIdRef.current === convoId) {
          dispatch({
            kind: "event",
            event: { type: "error", error: describeError(e) } as ChatEvent,
          });
        }
      } finally {
        if (convoIdRef.current === convoId) {
          setRunning(false);
          liveRef.current = false;
        }
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const convo = conversation;
      const trimmed = text.trim();
      if (!convo || !trimmed || !convo.baseAgent) return;

      dispatch({ kind: "user", text: trimmed });
      if (convo.title === "New chat") update(convo.id, { title: titleFrom(trimmed) });
      setRunning(true);
      beginTurnTiming();

      try {
        // Steer the live run if one is open.
        if (liveRef.current && runIdRef.current) {
          await client.sendRunInput(runIdRef.current, trimmed);
          return;
        }
        const ac = new AbortController();
        abortRef.current = ac;
        let stream: AsyncIterable<AgentEvent>;
        if (convo.sessionId) {
          // Resume an existing session with a fresh interactive run (server
          // replays the transcript; the stream carries only new events).
          stream = client.continueSession({
            sessionId: convo.sessionId,
            segments: [userSegment(trimmed)],
            interactive: true,
            signal: ac.signal,
          });
        } else {
          const agentName = await resolveConversationAgent(client, convo, baseDef, update);
          stream = client.runStreaming({
            agent: agentName,
            segments: [userSegment(trimmed)],
            interactive: true,
            signal: ac.signal,
          });
        }
        void consume(stream, convo.id);
      } catch (e) {
        if (!isAbortError(e)) {
          setRunning(false);
          dispatch({
            kind: "event",
            event: { type: "error", error: describeError(e) } as ChatEvent,
          });
        }
      }
    },
    [conversation, baseDef, client, update, consume, beginTurnTiming],
  );

  const cancel = useCallback(async () => {
    try {
      if (agentIdRef.current) await client.cancelAgent(agentIdRef.current);
    } catch {
      // best-effort
    }
    abortRef.current?.abort();
    liveRef.current = false;
    setRunning(false);
  }, [client]);

  const compact = useCallback(async () => {
    if (!state.runId) return undefined;
    // compactRun 409s on a mid-turn run — callers gate this on awaitingInput.
    return client.compactRun(state.runId);
  }, [client, state.runId]);

  const resolveInterrupt = useCallback(
    async (answer: string) => {
      const intr = state.pendingInterrupt;
      if (!intr || !state.runId) return;
      await client.resolveInterrupt(state.runId, intr.interrupt_id, { answer });
      dispatch({ kind: "clearInterrupt" });
    },
    [client, state.runId, state.pendingInterrupt],
  );

  // Persist run/session ids back onto the conversation as they are announced.
  useEffect(() => {
    if (!conversation) return;
    const patch: Partial<Conversation> = {};
    if (state.sessionId && state.sessionId !== conversation.sessionId) {
      patch.sessionId = state.sessionId;
    }
    if (state.runId && state.runId !== conversation.runId) {
      patch.runId = state.runId;
    }
    if (Object.keys(patch).length) update(conversation.id, patch);
  }, [state.runId, state.sessionId, conversation, update]);

  // Conversation switch: tear down the old stream, reset, and reload prior
  // history (re-attach to a live run, else read-only transcript). Keyed on id
  // only so persisting ids doesn't tear down the live stream.
  useEffect(() => {
    const convo = conversation;
    convoIdRef.current = convo?.id ?? null;
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = "";
    agentIdRef.current = "";
    liveRef.current = false;
    outputTokensRef.current = 0;
    outputAtTurnStartRef.current = 0;
    setTps(0);
    setRunning(false);

    if (!convo) {
      dispatch({ kind: "reset" });
      return;
    }
    dispatch({
      kind: "reset",
      seed: { sessionId: convo.sessionId ?? null, runId: convo.runId ?? null },
    });

    if (!convo.runId && !convo.sessionId) return;

    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      // Prefer re-attaching to a live run (replays history + live-tails).
      if (convo.runId) {
        try {
          runIdRef.current = convo.runId;
          setRunning(true);
          await consume(
            client.streamRunByID(convo.runId, { signal: ac.signal }),
            convo.id,
            true,
          );
          return;
        } catch (e) {
          if (isAbortError(e)) return;
          // Run has aged out — fall back to a read-only transcript.
          runIdRef.current = "";
          liveRef.current = false;
          setRunning(false);
        }
      }
      if (convo.sessionId && convoIdRef.current === convo.id) {
        try {
          const t = await client.getTranscript(convo.sessionId, { signal: ac.signal });
          if (convoIdRef.current !== convo.id) return;
          for (const event of transcriptToEvents(t)) {
            dispatch({ kind: "event", event });
          }
        } catch (e) {
          if (!isAbortError(e) && convoIdRef.current === convo.id) {
            dispatch({
              kind: "event",
              event: { type: "error", error: describeError(e) } as ChatEvent,
            });
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  // Abort any live stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, running, tokensPerSec, send, cancel, compact, resolveInterrupt };
}
