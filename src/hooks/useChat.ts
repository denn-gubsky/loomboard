import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  InteractiveSession,
  LibraryAgentDefinition,
} from "@loomcycle/client";
import { useLoomcycle } from "../state/connection";
import { useConversations, type Conversation } from "../state/conversations";
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from "../lib/eventReducer";
import type { ChatEvent } from "../lib/events";
import { tokensPerSecond } from "../lib/metrics";
import { userSegment } from "../lib/segments";
import { resolveConversationAgent } from "../lib/agentFork";
import { describeError, isAbortError } from "../lib/loomcycle";

export interface UseChat {
  state: ChatState;
  /** Currently producing output (composer disabled, stop button shown). */
  running: boolean;
  /** Live generation throughput for the current turn. */
  tokensPerSec: number;
  send: (text: string) => void;
  cancel: () => void;
  compact: () => Promise<void>;
  resolveInterrupt: (answer: string) => Promise<void>;
}

// Drives one conversation's interactive run (RFC AI). A conversation is a single
// long-lived interactive run: the first message starts it (parking at end_turn),
// follow-ups steer the SAME run, and reopening re-attaches by run_id. The event
// stream feeds the pure reducer; this hook owns only the impure parts (the
// driver lifecycle, wall-clock timing, persistence of run/session ids).
export function useChat(
  conversation: Conversation | null,
  baseDef: LibraryAgentDefinition | undefined,
): UseChat {
  const client = useLoomcycle();
  const { update } = useConversations();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [running, setRunning] = useState(false);
  const [tokensPerSec, setTps] = useState(0);

  const driverRef = useRef<InteractiveSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards async dispatches against a conversation switch mid-stream.
  const convoIdRef = useRef<string | null>(null);

  // tokens/sec bookkeeping (the reducer is pure, so timing lives here).
  const turnStartRef = useRef(0);
  const outputTokensRef = useRef(0);
  const outputAtTurnStartRef = useRef(0);

  const consume = useCallback(
    async (driver: InteractiveSession, convoId: string) => {
      try {
        for await (const ev of driver.events()) {
          if (convoIdRef.current !== convoId) break;
          const event = ev as ChatEvent;
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
        if (!isAbortError(e) && convoIdRef.current === convoId) {
          dispatch({
            kind: "event",
            event: { type: "error", error: describeError(e) } as ChatEvent,
          });
        }
      } finally {
        if (convoIdRef.current === convoId) {
          setRunning(false);
          driverRef.current = null;
        }
      }
    },
    [],
  );

  const beginTurnTiming = useCallback(() => {
    turnStartRef.current = Date.now();
    outputAtTurnStartRef.current = outputTokensRef.current;
    setTps(0);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const convo = conversation;
      const trimmed = text.trim();
      if (!convo || !trimmed || !convo.baseAgent) return;

      dispatch({ kind: "user", text: trimmed });
      setRunning(true);
      beginTurnTiming();

      try {
        const driver = driverRef.current;
        if (driver && driver.runId) {
          // Follow-up: steer the live run. Response arrives on the same stream.
          await driver.send(trimmed);
          return;
        }
        // First turn: resolve the agent (forking a private def if the chat has
        // custom config), then open the interactive run.
        const agentName = await resolveConversationAgent(client, convo, baseDef, update);
        const ac = new AbortController();
        abortRef.current = ac;
        const fresh = client.interactiveSession({
          agent: agentName,
          segments: [userSegment(trimmed)],
          signal: ac.signal,
        });
        driverRef.current = fresh;
        void consume(fresh, convo.id);
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
      await driverRef.current?.cancel();
    } catch {
      // best-effort
    }
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const compact = useCallback(async () => {
    if (!state.runId) return;
    await client.compactRun(state.runId);
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

  // Conversation switch: tear down the old stream, reset state, and re-attach to
  // a live run if one exists. Keyed on id only so persisting run/session ids
  // (which mutate the conversation object) doesn't tear down the live stream.
  useEffect(() => {
    const convo = conversation;
    convoIdRef.current = convo?.id ?? null;
    abortRef.current?.abort();
    abortRef.current = null;
    driverRef.current = null;
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

    if (convo.runId) {
      const ac = new AbortController();
      abortRef.current = ac;
      const driver = client.attachInteractiveSession(convo.runId, {
        signal: ac.signal,
      });
      driverRef.current = driver;
      setRunning(true);
      void consume(driver, convo.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  // Abort any live stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, running, tokensPerSec, send, cancel, compact, resolveInterrupt };
}
