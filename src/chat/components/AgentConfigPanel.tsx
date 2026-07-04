import { useEffect, useState } from "react";
import type { LibraryAgentDefinition } from "@loomcycle/client";
import {
  configIsCustom,
  sameConfig,
  type ConversationConfig,
} from "../types";

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
// On Anthropic/Gemini `low` disables extended thinking; medium/high enable it.
const EFFORTS: { value: string; label: string }[] = [
  { value: "low", label: "low (no extended thinking)" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

// Per-conversation model overrides. Anything set here diverges from the base
// agent and triggers a private AgentDef fork at first send. Empty fields inherit
// the base agent (its defaults shown as the placeholder hint).
//
// Edits are staged in a local draft and take effect only on Apply — so a
// half-changed provider/model pair is never sent. Restore clears the overrides
// back to the agent's own settings.
export default function AgentConfigPanel({ config, baseDef, onChange }: Props) {
  const [draft, setDraft] = useState<ConversationConfig>(config);

  // Re-sync when the applied config changes under us (conversation switch, or
  // the fork write-back), so the draft always starts from what's in effect.
  useEffect(() => {
    setDraft(config);
  }, [config]);

  function set<K extends keyof ConversationConfig>(
    key: K,
    val: ConversationConfig[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  const dirty = !sameConfig(draft, config);
  // Something to reset: an applied override to clear, or staged edits to drop.
  const canRestore = configIsCustom(config) || dirty;

  function apply() {
    onChange(draft);
  }

  function restore() {
    // "Restore current agent settings" = drop all overrides (inherit). Takes
    // effect immediately, and also discards any unsaved edits.
    const defaults: ConversationConfig = {};
    setDraft(defaults);
    onChange(defaults);
  }

  const inherit = (v?: string) => (v ? `inherit (${v})` : "inherit");

  return (
    <div className="config-panel">
      <p className="config-hint">
        Overrides fork a private agent definition for this chat. Leave a field on
        “inherit” to keep the agent’s default. Changes apply on <b>Apply</b>.
      </p>

      <label className="config-field">
        <span>Provider</span>
        <select
          value={draft.provider ?? ""}
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
          value={draft.model ?? ""}
          placeholder={baseDef?.model ? `inherit (${baseDef.model})` : "inherit"}
          onChange={(e) => set("model", e.target.value || undefined)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="config-field">
        <span>Tier</span>
        <select
          value={draft.tier ?? ""}
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
          value={draft.effort ?? ""}
          onChange={(e) => set("effort", e.target.value || undefined)}
        >
          <option value="">{inherit(baseDef?.effort)}</option>
          {EFFORTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <div className="config-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={restore}
          disabled={!canRestore}
          title="Restore the agent's own settings (clear overrides)"
        >
          Restore
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={apply}
          disabled={!dirty}
          title="Apply these overrides to this chat"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
