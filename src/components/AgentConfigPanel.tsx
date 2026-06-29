import type { LibraryAgentDefinition } from "@loomcycle/client";
import type { ConversationConfig } from "../state/conversations";

interface Props {
  config: ConversationConfig;
  baseDef?: LibraryAgentDefinition;
  onChange: (next: ConversationConfig) => void;
}

// Known providers. Free-text model field, since model ids vary per provider.
const PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "gemini",
  "ollama",
  "ollama-local",
];
const TIERS = ["low", "middle", "high"];
// effort = thinking-mode depth (Anthropic thinking budget / OpenAI
// reasoning_effort / DeepSeek toggle). Empty = inherit the agent's setting.
const EFFORTS = ["low", "medium", "high"];

// Per-conversation model overrides. Anything set here diverges from the base
// agent and triggers a private AgentDef fork at first send. Empty fields
// inherit the base agent (its defaults shown as the placeholder hint).
export default function AgentConfigPanel({ config, baseDef, onChange }: Props) {
  function set<K extends keyof ConversationConfig>(
    key: K,
    val: ConversationConfig[K],
  ) {
    onChange({ ...config, [key]: val });
  }

  const inherit = (v?: string) => (v ? `inherit (${v})` : "inherit");

  return (
    <div className="config-panel">
      <p className="config-hint">
        Overrides fork a private agent definition for this chat. Leave a field on
        “inherit” to keep the agent’s default.
      </p>

      <label className="config-field">
        <span>Provider</span>
        <select
          value={config.provider ?? ""}
          onChange={(e) => set("provider", e.target.value || undefined)}
        >
          <option value="">{inherit(baseDef?.provider)}</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="config-field">
        <span>Model</span>
        <input
          type="text"
          value={config.model ?? ""}
          placeholder={baseDef?.model ? `inherit (${baseDef.model})` : "inherit"}
          onChange={(e) => set("model", e.target.value || undefined)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="config-field">
        <span>Tier</span>
        <select
          value={config.tier ?? ""}
          onChange={(e) => set("tier", e.target.value || undefined)}
        >
          <option value="">{inherit(baseDef?.tier)}</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="config-field">
        <span>Thinking (effort)</span>
        <select
          value={config.effort ?? ""}
          onChange={(e) => set("effort", e.target.value || undefined)}
        >
          <option value="">{inherit(baseDef?.effort)}</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
