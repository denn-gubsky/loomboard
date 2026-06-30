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
import { buildUserSegments } from "../lib/segments";
import { resolveConversationAgent } from "../lib/agentFork";
import type { SentAttachment, StagedAttachment } from "../lib/attachments";
import { describeError, isAbortError } from "../lib/loomcycle";

export interface UseChat {
  state: ChatState;
  running: boolean;
  tokensPerSec: number;
  send: (text: string, attachments?: StagedAttachment[]) => void;
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
// plain follow-ups steer it via sendRunInput, and reopening re-attaches by
// run_id (or replays the transcript). Turns carrying attachments can't use the
// text-only steer path, so they (re)start the run with rich segments via
// continueSession/runStreaming. A monotonic `gen` token marks the active stream
// so a superseding turn never races the one it replaced.
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
  const genRef = useRef(0); // active-stream generation
  const runIdRef = useRef("");
  const agentIdRef = useRef("");
  const liveRef = useRef(false);

  const turnStartRef = useRef(0);
  const outputTokensRef = useRef(0);
  const outputAtTurnStartRef = useRef(0);
  const turnCharsRef = useRef(0);
  const lastTpsTsRef = useRef(0);
  // Reasoning-phase timing: start on the first `thinking` delta, stop when the
  // model starts answering (or the turn ends) → "Thought for N s".
  const thinkingActiveRef = useRef(false);
  const thinkingStartRef = useRef(0);

  const beginTurnTiming = useCallback(() => {
    turnStartRef.current = Date.now();
    outputAtTurnStartRef.current = outputTokensRef.current;
    turnCharsRef.current = 0;
    lastTpsTsRef.current = 0;
    thinkingActiveRef.current = false;
    setTps(0);
  }, []);

  // Consume an event stream into the reducer, tagged with its generation. A
  // newer stream (gen bump) makes this one stop dispatching and stop owning the
  // running/live flags. `rethrowStartError` lets the re-attach path detect a
  // dead run (error before any frame) and fall back to the transcript.
  const consume = useCallback(
    async (stream: AsyncIterable<AgentEvent>, gen: number) => {
      liveRef.current = true;
      try {
        for await (const ev of stream) {
          if (genRef.current !== gen) break;
          const event = ev as ChatEvent;
          if (event.type === "agent") {
            if (event.run_id) runIdRef.current = event.run_id;
            if (event.agent_id) agentIdRef.current = event.agent_id;
          }

          // Time the reasoning phase and stamp its duration onto the thinking
          // part the moment the model stops thinking (first answer/tool/done).
          if (event.type === "thinking") {
            if (!thinkingActiveRef.current) {
              thinkingActiveRef.current = true;
              thinkingStartRef.current = Date.now();
            }
          } else if (
            thinkingActiveRef.current &&
            (event.type === "text" ||
              event.type === "tool_call" ||
              event.type === "done" ||
              event.type === "error" ||
              event.type === "awaiting_input")
          ) {
            thinkingActiveRef.current = false;
            dispatch({ kind: "thinkingDuration", ms: Date.now() - thinkingStartRef.current });
          }

          dispatch({ kind: "event", event });

          const liveTurn = turnStartRef.current > 0;
          if (liveTurn && event.type === "text" && event.text) {
            turnCharsRef.current += event.text.length;
            const now = Date.now();
            if (now - lastTpsTsRef.current > 150) {
              lastTpsTsRef.current = now;
              setTps(
                tokensPerSecond(turnCharsRef.current / 4, now - turnStartRef.current),
              );
            }
          }
          if (event.type === "usage" && event.usage) {
            outputTokensRef.current += event.usage.output_tokens ?? 0;
            if (liveTurn) {
              setTps(
                tokensPerSecond(
                  outputTokensRef.current - outputAtTurnStartRef.current,
                  Date.now() - turnStartRef.current,
                ),
              );
            }
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
        if (genRef.current === gen) {
          dispatch({
            kind: "event",
            event: { type: "error", error: describeError(e) } as ChatEvent,
          });
        }
      } finally {
        if (genRef.current === gen) {
          setRunning(false);
          liveRef.current = false;
        }
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string, attachments: StagedAttachment[] = []) => {
      const convo = conversation;
      const trimmed = text.trim();
      if (!convo || !convo.baseAgent) return;
      const ready = attachments.filter((a) => a.status === "ready");
      if (!trimmed && ready.length === 0) return;

      const sent: SentAttachment[] = ready.map((a) => ({
        name: a.name,
        kind: a.kind,
        dataUrl: a.dataUrl,
      }));
      dispatch({
        kind: "user",
        text: trimmed,
        attachments: sent.length ? sent : undefined,
      });
      if (convo.title === "New chat" && trimmed) {
        update(convo.id, { title: titleFrom(trimmed) });
      }
      setRunning(true);
      beginTurnTiming();

      try {
        // Fast path: steer a live run with plain text (no attachments).
        if (ready.length === 0 && liveRef.current && runIdRef.current) {
          await client.sendRunInput(runIdRef.current, trimmed);
          return;
        }
        // Segments path: attachments, or a fresh/resumed turn. Supersede any
        // live stream (the abandoned parked run is replayed server-side by
        // continueSession).
        const segments = buildUserSegments(trimmed, ready);
        if (segments.length === 0) {
          setRunning(false);
          return;
        }
        const gen = ++genRef.current;
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        let stream: AsyncIterable<AgentEvent>;
        if (convo.sessionId) {
          stream = client.continueSession({
            sessionId: convo.sessionId,
            segments,
            interactive: true,
            signal: ac.signal,
          });
        } else {
          const agentName = await resolveConversationAgent(client, convo, baseDef, update);
          stream = client.runStreaming({
            agent: agentName,
            segments,
            interactive: true,
            signal: ac.signal,
          });
        }
        void consume(stream, gen);
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

  // Conversation switch: tear down the old stream, reset, reload history
  // (re-attach to a live run, else read-only transcript). Keyed on id only.
  useEffect(() => {
    const convo = conversation;
    const gen = ++genRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = "";
    agentIdRef.current = "";
    liveRef.current = false;
    outputTokensRef.current = 0;
    outputAtTurnStartRef.current = 0;
    turnStartRef.current = 0;
    thinkingActiveRef.current = false;
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

    if (!convo.sessionId) return;

    // Reload history from the transcript (role-aware: keeps user turns, skips
    // the system prompt). We deliberately don't re-attach to a live run via
    // streamRunByID — its replay synthesizes role-blind steer frames that would
    // leak the system prompt and double user turns. The next send resumes the
    // session via continueSession.
    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      try {
        const t = await client.getTranscript(convo.sessionId!, { signal: ac.signal });
        if (genRef.current !== gen) return;
        for (const event of transcriptToEvents(t)) {
          dispatch({ kind: "event", event });
        }
      } catch (e) {
        if (!isAbortError(e) && genRef.current === gen) {
          dispatch({
            kind: "event",
            event: { type: "error", error: describeError(e) } as ChatEvent,
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  // Abort any live stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, running, tokensPerSec, send, cancel, compact, resolveInterrupt };
}
