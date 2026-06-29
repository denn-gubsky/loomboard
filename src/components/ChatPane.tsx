import { useState } from "react";
import { Settings2 } from "lucide-react";
import { configIsCustom, useConversations } from "../state/conversations";
import { useAgents } from "../hooks/useAgents";
import { useChat } from "../hooks/useChat";
import AgentPicker from "./AgentPicker";
import AgentConfigPanel from "./AgentConfigPanel";
import MessageList from "./MessageList";
import Composer from "./Composer";

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
      </header>

      {showConfig && (
        <AgentConfigPanel
          config={active.config}
          baseDef={baseDef}
          onChange={(next) => update(active.id, { config: next })}
        />
      )}

      <MessageList messages={chat.state.messages} running={chat.running} />

      <Composer
        disabled={noAgent}
        running={chat.running}
        onSend={chat.send}
        onStop={chat.cancel}
        placeholder={
          noAgent ? "Pick an agent to start" : `Message ${active.baseAgent}…`
        }
      />
    </section>
  );
}
