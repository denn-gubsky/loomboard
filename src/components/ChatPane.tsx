import { useState } from "react";
import { Settings2 } from "lucide-react";
import {
  configIsCustom,
  useConversations,
} from "../state/conversations";
import { useAgents } from "../hooks/useAgents";
import AgentPicker from "./AgentPicker";
import AgentConfigPanel from "./AgentConfigPanel";

export default function ChatPane() {
  const { active, update } = useConversations();
  const { agents, loading, error } = useAgents();
  const [showConfig, setShowConfig] = useState(false);

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

  const baseDef = agents.find((a) => a.name === active.baseAgent)
    ?.static_definition;
  const custom = configIsCustom(active.config);

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

      <div className="chat-body">
        <div className="chat-empty">
          {active.baseAgent ? (
            <p>
              Chatting with <strong>{active.baseAgent}</strong>. Message
              streaming lands in the next step.
            </p>
          ) : (
            <p>Pick an agent above to start.</p>
          )}
        </div>
      </div>
    </section>
  );
}
