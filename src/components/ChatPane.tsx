import { useState } from "react";
import { Settings2 } from "lucide-react";
import { configIsCustom, useConversations } from "../state/conversations";
import { useAgents } from "../hooks/useAgents";
import { useChat } from "../hooks/useChat";
import AgentPicker from "./AgentPicker";
import AgentConfigPanel from "./AgentConfigPanel";
import MessageList from "./MessageList";
import Composer from "./Composer";
import MetricsHud from "./MetricsHud";
import CompactButton from "./CompactButton";
import InterruptCard from "./InterruptCard";

export default function ChatPane() {
  const { active, update } = useConversations();
  const { agents, loading, error } = useAgents();
  const [showConfig, setShowConfig] = useState(false);

  const baseDef = active
    ? agents.find((a) => a.name === active.baseAgent)?.static_definition
    : undefined;

  // Hooks must run unconditionally — useChat handles a null conversation.
  const chat = useChat(active, baseDef);

  if (!active) {
    return (
      <section className="chat-pane empty">
        <div className="chat-empty">
          <h2>loomboard</h2>
          <p>Start a new chat or pick one from the sidebar.</p>
        </div>
      </section>
    );
  }

  const custom = configIsCustom(active.config);
  const noAgent = !active.baseAgent;
  const hasUsage = chat.state.metrics.inputTokens > 0 || chat.state.metrics.outputTokens > 0;

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <AgentPicker
          value={active.baseAgent}
          onChange={(name) => update(active.id, { baseAgent: name })}
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
          config={active.config}
          baseDef={baseDef}
          onChange={(next) => update(active.id, { config: next })}
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
        onSend={chat.send}
        onStop={chat.cancel}
        placeholder={
          chat.state.pendingInterrupt
            ? "Answer the agent's question above"
            : noAgent
              ? "Pick an agent to start"
              : `Message ${active.baseAgent}…`
        }
      />
    </section>
  );
}
