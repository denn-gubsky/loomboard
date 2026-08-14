import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  AgentEvent,
  CompactRunResult,
  LibraryAgentDefinition,
  LoomcycleClient,
} from "@loomcycle/client";
import { type ChatConversation as Conversation } from "../types";
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from "../lib/eventReducer";
import { lastSeqForRun, transcriptToEvents, type ChatEvent } from "../lib/events";
import { tokensPerSecond } from "../lib/metrics";
import { buildUserSegments } from "../lib/segments";
import { resolveConversationAgent } from "../lib/agentFork";
import type { SentAttachment, StagedAttachment } from "../lib/attachments";
import { describeError, isAbortError } from "../lib/errors";

export interface UseChat {
  state: ChatState;
  running: boolean;
  tokensPerSec: number;
  send: (text: string, attachments?: StagedAttachment[]) => void;
  cancel: () => void;
  compact: () => Promise<CompactRunResult | undefined>;
  /** True while a compaction request is in flight (drives the in-chat progress). */
  compacting: boolean;
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
  client: LoomcycleClient,
  conversation: Conversation | null,
  baseDef: LibraryAgentDefinition | undefined,
  onChange: (patch: Partial<Conversation>) => void,
): UseChat {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [running, setRunning] = useState(false);
  const [tokensPerSec, setTps] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0); // active-stream generation
  const runIdRef = useRef("");
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
        onChange({ title: titleFrom(trimmed) });
      }
      setRunning(true);
      beginTurnTiming();

      try {
        // Fast path: steer the live run with plain text (no attachments) so the
        // whole conversation stays under ONE run_id. If the steer fails (the run
        // was reaped / went terminal since we attached), fall through to
        // continueSession, which resumes the session with a fresh run.
        if (ready.length === 0 && liveRef.current && runIdRef.current) {
          try {
            await client.sendRunInput(runIdRef.current, trimmed);
            return;
          } catch (e) {
            if (isAbortError(e)) return;
            liveRef.current = false;
            console.warn("[chat] steer failed; resuming via continueSession", e);
          }
        }
        // Segments path: attachments, or a fresh/resumed turn (no live run to
        // steer). continueSession replays the session server-side into a new run.
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
          const agentName = await resolveConversationAgent(client, convo, baseDef, onChange);
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
    [conversation, baseDef, client, onChange, consume, beginTurnTiming],
  );

  const cancel = useCallback(async () => {
    // Stop the CURRENT turn — the in-flight generation plus the tool calls it
    // started, including a blocked Interruption (RFC BH cancelTurn). The run
    // parks at awaiting_input with the session intact, so the next message
    // resumes it. This is the "Esc" gesture, NOT whole-run cancel (cancelAgent),
    // which would end the chat. cancelTurn keys on run_id — known live
    // (runIdRef) or from a reopened conversation (state.runId).
    const runId = runIdRef.current || state.runId || "";
    // Supersede any live stream so its frames stop landing while we settle; the
    // next send resumes the parked run via continueSession.
    genRef.current++;
    abortRef.current?.abort();
    liveRef.current = false;
    setRunning(false);
    try {
      if (runId) await client.cancelTurn(runId, { reason: "operator cancelled" });
    } catch (e) {
      // 409 (not mid-turn / not interactive) or 404 (run gone): nothing to
      // stop — settle the UI anyway. Logged for devtools.
      console.warn("[chat] cancelTurn failed", e);
    }
    dispatch({ kind: "turnStopped" });
  }, [client, state.runId]);

  const [compacting, setCompacting] = useState(false);
  const compact = useCallback(async () => {
    if (!state.runId) return undefined;
    // compactRun 409s on a mid-turn run — callers gate this on awaitingInput.
    setCompacting(true);
    try {
      const r = await client.compactRun(state.runId);
      // On a real compaction, post the result to the transcript and refresh the
      // context gauge (the button only signals no-op/errors now).
      if (r?.compacted) {
        dispatch({ kind: "compacted", before: r.before_tokens, after: r.after_tokens });
      }
      return r;
    } finally {
      setCompacting(false);
    }
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
    if (Object.keys(patch).length) onChange(patch);
  }, [state.runId, state.sessionId, conversation, onChange]);

  // Conversation switch: tear down the old stream, reset, reload history
  // (re-attach to a live run, else read-only transcript). Keyed on id only.
  useEffect(() => {
    const convo = conversation;
    const gen = ++genRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = "";
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
    // the system prompt), THEN re-attach to the session's live interactive run
    // (below) so follow-up turns steer the SAME run — keeping the whole
    // conversation under one run_id. Safe because we tail from the run's last
    // seq (no history replay) and the reducer ignores steer frames (so the
    // re-attach can't double user turns or leak the flattened system prompt).
    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      try {
        const t = await client.getTranscript(convo.sessionId!, { signal: ac.signal });
        if (genRef.current !== gen) return;
        for (const event of transcriptToEvents(t)) {
          dispatch({ kind: "event", event });
        }
        // Re-attach a genuinely-pending interrupt with its LIVE id (the
        // transcript's historical one is skipped — its id would be stale and
        // answering it 409s). Keyed on the run; best-effort.
        if (convo.runId) {
          const res = await client.listRunInterrupts(convo.runId, {
            status: "pending",
            signal: ac.signal,
          });
          if (genRef.current !== gen) return;
          const pending = res.interrupts[0];
          if (pending) {
            dispatch({
              kind: "event",
              event: {
                type: "interruption_pending",
                interruption: {
                  interrupt_id: pending.interrupt_id,
                  kind: pending.kind,
                  question: pending.question,
                  options: pending.options,
                  context: pending.context_data,
                  priority: pending.priority,
                  expires_at: pending.expires_at,
                },
              } as ChatEvent,
            });
          }

          // Re-attach so plain follow-ups STEER this run (one run_id per
          // session). Tail from the run's last seq so the rendered history
          // isn't replayed. consume() flips liveRef on: a parked run keeps the
          // stream open (→ steer path); a terminal run drains + ends, so liveRef
          // falls back off and the next send uses continueSession.
          runIdRef.current = convo.runId;
          void consume(
            client.streamRunByID(convo.runId, {
              fromSeq: lastSeqForRun(t.events, convo.runId),
              signal: ac.signal,
            }),
            gen,
          );
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

  return {
    state,
    running,
    tokensPerSec,
    send,
    cancel,
    compact,
    compacting,
    resolveInterrupt,
  };
}
