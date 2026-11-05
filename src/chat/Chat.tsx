import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Settings2 } from "lucide-react";
import { createLoomcycleClient, type Connection } from "./lib/createClient";
import { configIsCustom, type ChatConversation } from "./types";
import type { UserMessage } from "./lib/eventReducer";
import { useAgents } from "./hooks/useAgents";
import { useChat } from "./hooks/useChat";
import { useEffectiveConfig } from "./hooks/useEffectiveConfig";
import { effectiveFields, inertSettings } from "./lib/effective";
import { estimateConversationTokens } from "./lib/metrics";
import { createDocPreviewCache } from "./lib/docPreview";
import { DocLinksContext, type DocLinks, type DocumentOpenTarget } from "./hooks/useDocLinks";
import { ReadAloudContext, useReadAloud } from "./hooks/useReadAloud";
import { useSpeechCaps } from "./hooks/useSpeechCaps";
import AgentPicker from "./components/AgentPicker";
import OverridesPanel from "./components/OverridesPanel";
import MessageList from "./components/MessageList";
import Composer from "./components/Composer";
import MetricsHud from "./components/MetricsHud";
import CompactButton from "./components/CompactButton";
import InterruptCard from "./components/InterruptCard";

export interface ChatProps {
  /** How to reach loomcycle. The component builds (and memoizes) its client. */
  connection: Connection;
  /** The conversation to drive — controlled by the host, which owns selection
   *  and persistence. */
  conversation: ChatConversation;
  /** Write-back for state the chat produces: session/run/fork ids, title, and
   *  the agent/config the user picks in the header. */
  onConversationChange: (patch: Partial<ChatConversation>) => void;
  /** Force the palette. Omit to inherit a light/dark ancestor (a host that sets
   *  data-theme on a wrapper or <html>); the component defaults to dark. */
  theme?: "light" | "dark";
  /** Inline style spread onto the root `.loomchat` element. The intended use is
   *  overriding the CSS tokens the whole surface reads from — e.g.
   *  `style={{ "--accent": agentColor } as CSSProperties}` — so a host (like an
   *  agent tile / overlay) can recolor the chat per agent. */
  style?: CSSProperties;
  /** Called when the run's active state changes. `running` = the agent is
   *  working (thinking / responding / using tools); `needsInput` = it parked on
   *  a question. Lets a host show a live activity indicator — the aggregate
   *  run-state feed lags a just-started run and can't tell working from parked. */
  onRunStatus?: (status: { running: boolean; needsInput: boolean }) => void;
  /** The conversation's stored recap summary, shown as a ghost note at the top
   *  of the transcript. The host supplies it (e.g. from the History tool). */
  recap?: string;
  /** Agent-name suggestions for the free-text fallback the picker shows when the
   *  agent library can't be read (a user token 403s on the tenant-scoped list). */
  knownAgents?: string[];
  /** Which agents the picker offers, by name — e.g. only a host's chat
   *  agents. The conversation's current agent is always offered, and a filter
   *  that matches no agent is ignored, so the picker is never left empty.
   *  Omit to offer every agent. */
  agentFilter?: (name: string) => boolean;
  /** Whether pressing Escape cancels this chat's current turn (RFC BH). Default
   *  true. The Escape listener is window-global, so a host stacking several
   *  <Chat> panes must set this true for ONLY the focused pane — otherwise one
   *  Escape cancels every running pane at once. */
  escapeStops?: boolean;
  /** Seed the composer with this text on first mount (the user reviews and sends
   *  it). Lets a host open a chat pre-filled with a task — e.g. the workflow
   *  board starting an orchestrator with the board's context. */
  initialInput?: string;
  /** Show a document the agent linked (`[title](loom:doc/<id>)` or
   *  `loom:chunk/<id>`, and the ids in its Document tool results). A chunk link
   *  arrives with its document already looked up. Omit it and the links still
   *  preview on hover, with no control to open them. */
  onOpenDocument?: (target: DocumentOpenTarget) => void;
  /** Voice controls (RFC FX). Each shows only where the connected loomcycle
   *  (1.140+) offers it to this user, as its `whoami` reports. `false` turns
   *  voice off for this host; `{ output: false }` hides read-aloud. */
  voice?: false | { output?: boolean };
}

// The embeddable chat surface for a single conversation: agent picker, model /
// thinking config, streamed messages (text, reasoning, tools), token metrics,
// context compaction, interrupts, and an attachment-aware composer. The host
// supplies the connection and the conversation record and persists the patches
// this emits; everything else (which chat is shown, the list) lives outside.
export default function Chat({
  connection,
  conversation,
  onConversationChange,
  theme,
  style,
  onRunStatus,
  recap,
  knownAgents,
  agentFilter,
  escapeStops = true,
  initialInput,
  onOpenDocument,
  voice,
}: ChatProps) {
  const client = useMemo(
    () => createLoomcycleClient(connection),
    // A new client only when the connection identity changes; the host should
    // pass a stable `fetch`.
    [connection.baseUrl, connection.token, connection.fetch],
  );
  const { agents, loading, error } = useAgents(client);
  // One preview cache per client, shared by every link in the conversation.
  const previews = useMemo(() => createDocPreviewCache((input) => client.document(input)), [client]);
  const docLinks = useMemo<DocLinks>(() => ({ previews, open: onOpenDocument }), [previews, onOpenDocument]);
  const [showConfig, setShowConfig] = useState(false);
  const speechCaps = useSpeechCaps(client, { output: voice !== false && voice?.output !== false, input: false });
  const readAloud = useReadAloud(client, speechCaps.speech, conversation.id);

  const baseDef = agents.find(
    (a) => a.name === conversation.baseAgent,
  )?.static_definition;
  const chat = useChat(client, conversation, onConversationChange);
  // What the live run actually uses, for the settings panel. Re-read whenever a
  // turn ends or the run changes: the report is a snapshot, and a turn is when
  // a retune or a fallback can have moved something.
  const effectiveReport = useEffectiveConfig(
    client,
    chat.state.runId,
    chat.state.messages.length,
  );
  const effective = useMemo(() => effectiveFields(effectiveReport), [effectiveReport]);
  const inert = useMemo(() => inertSettings(effectiveReport), [effectiveReport]);

  // Esc stops the current operation, like Claude Code — a live turn or a run
  // parked on a question — via RFC BH turn-cancel: the chat stays alive to
  // continue, it isn't terminated. Window-level so it works regardless of focus;
  // gated so it never fires (and never preventDefaults) on an idle chat.
  const { running, cancel } = chat;
  const parked = chat.state.pendingInterrupt;
  useEffect(() => {
    // Skip when idle (never preventDefault an inert Escape) or when the host has
    // handed Escape to another pane (escapeStops=false) — see the prop doc.
    if ((!running && !parked) || !escapeStops) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, parked, cancel, escapeStops]);

  // Publish the run's active state to the host (sidebar tile activity dot). A
  // run parked on a question isn't "working" (the loop stays running until the
  // answer, so `running` alone would pulse forever) — report needsInput instead.
  useEffect(() => {
    onRunStatus?.({ running: running && !parked, needsInput: Boolean(parked) });
  }, [running, parked, onRunStatus]);
  // Reset when this chat unmounts (deselected), so its tile stops reading active.
  useEffect(
    () => () => onRunStatus?.({ running: false, needsInput: false }),
    [onRunStatus],
  );

  const custom = configIsCustom(conversation.config);
  const noAgent = !conversation.baseAgent;
  const m = chat.state.metrics;
  // What the whole conversation weighs, beside what the last prompt carried.
  const conversationTokens = useMemo(
    () => estimateConversationTokens(chat.state.messages),
    [chat.state.messages],
  );
  const hasUsage = m.inputTokens > 0 || m.outputTokens > 0;
  // Tokens left in the model's window, for the attachment budget (null = the
  // model didn't report a window, so we can't enforce).
  const freeTokens =
    m.maxContextTokens > 0 ? Math.max(0, m.maxContextTokens - m.contextTokens) : null;
  // This conversation's prior user messages (oldest first) for ↑/↓ recall.
  const userInputs = chat.state.messages
    .filter((msg): msg is UserMessage => msg.role === "user" && msg.text.trim().length > 0)
    .map((msg) => msg.text);

  return (
    <section className="loomchat" data-theme={theme} style={style}>
      <header className="chat-header">
        <AgentPicker
          value={conversation.baseAgent}
          onChange={(name) => onConversationChange({ baseAgent: name })}
          agents={agents}
          loading={loading}
          error={error}
          knownAgents={knownAgents}
          agentFilter={agentFilter}
        />
        <button
          className={custom ? "config-toggle active" : "config-toggle"}
          onClick={() => setShowConfig((s) => !s)}
          title="Model & thinking configuration"
        >
          <Settings2 size={16} /> {custom ? "Custom" : "Config"}
        </button>

        <div className="header-spacer" />

        {(hasUsage || chat.running) && (
          <MetricsHud
            metrics={chat.state.metrics}
            conversationTokens={conversationTokens}
            tokensPerSec={chat.tokensPerSec}
            running={chat.running}
            servingModel={chat.state.servingModel}
            servingProvider={chat.state.servingProvider}
          />
        )}
        {chat.state.runId && (
          <CompactButton
            enabled={chat.state.awaitingInput && !chat.running}
            onCompact={chat.compact}
          />
        )}
      </header>

      {showConfig && (
        <OverridesPanel
          config={conversation.config}
          baseDef={baseDef}
          effective={effective}
          inert={inert}
          legacyFork={conversation.forkDefName}
          onChange={(next) => onConversationChange({ config: next })}
        />
      )}

      <DocLinksContext.Provider value={docLinks}>
        <ReadAloudContext.Provider value={readAloud}>
          <MessageList
            messages={chat.state.messages}
            running={chat.running}
            recap={recap}
            compacting={chat.compacting}
          />
        </ReadAloudContext.Provider>
      </DocLinksContext.Provider>

      {chat.state.pendingInterrupt && (
        <InterruptCard
          interrupt={chat.state.pendingInterrupt}
          onResolve={chat.resolveInterrupt}
          onCancel={chat.cancel}
        />
      )}

      <Composer
        disabled={noAgent || !!chat.state.pendingInterrupt}
        running={chat.running}
        freeTokens={freeTokens}
        history={userInputs}
        historyKey={conversation.id}
        initialText={initialInput}
        onSend={chat.send}
        onStop={chat.cancel}
        placeholder={
          chat.state.pendingInterrupt
            ? "Answer the agent's question above"
            : noAgent
              ? "Pick an agent to start"
              : `Message ${conversation.baseAgent}…`
        }
      />
    </section>
  );
}
