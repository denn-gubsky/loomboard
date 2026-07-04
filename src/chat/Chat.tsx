import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { createLoomcycleClient, type Connection } from "./lib/createClient";
import { configIsCustom, type ChatConversation } from "./types";
import type { UserMessage } from "./lib/eventReducer";
import { useAgents } from "./hooks/useAgents";
import { useChat } from "./hooks/useChat";
import AgentPicker from "./components/AgentPicker";
import AgentConfigPanel from "./components/AgentConfigPanel";
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
}: ChatProps) {
  const client = useMemo(
    () => createLoomcycleClient(connection),
    // A new client only when the connection identity changes; the host should
    // pass a stable `fetch`.
    [connection.baseUrl, connection.token, connection.fetch],
  );
  const { agents, loading, error } = useAgents(client);
  const [showConfig, setShowConfig] = useState(false);

  const baseDef = agents.find(
    (a) => a.name === conversation.baseAgent,
  )?.static_definition;
  const chat = useChat(client, conversation, baseDef, onConversationChange);

  const custom = configIsCustom(conversation.config);
  const noAgent = !conversation.baseAgent;
  const m = chat.state.metrics;
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
    <section className="loomchat" data-theme={theme}>
      <header className="chat-header">
        <AgentPicker
          value={conversation.baseAgent}
          onChange={(name) => onConversationChange({ baseAgent: name })}
          agents={agents}
          loading={loading}
          error={error}
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
        <AgentConfigPanel
          config={conversation.config}
          baseDef={baseDef}
          onChange={(next) => onConversationChange({ config: next })}
        />
      )}

      <MessageList messages={chat.state.messages} running={chat.running} />

      {chat.state.pendingInterrupt && (
        <InterruptCard
          interrupt={chat.state.pendingInterrupt}
          onResolve={chat.resolveInterrupt}
        />
      )}

      <Composer
        disabled={noAgent || !!chat.state.pendingInterrupt}
        running={chat.running}
        freeTokens={freeTokens}
        history={userInputs}
        historyKey={conversation.id}
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
