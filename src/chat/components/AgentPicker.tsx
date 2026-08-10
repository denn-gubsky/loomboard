import { Bot } from "lucide-react";
import { isRetiredAgent, pickableAgents, type AgentEntry } from "../hooks/useAgents";

interface Props {
  value: string;
  onChange: (name: string) => void;
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
  /** Agent names to suggest when the library list is unavailable (a delegated
   *  user token can't read /v1/_library/agents) — e.g. the user's recent agents. */
  knownAgents?: string[];
}

// Presentational agent selector. The agent list is fetched by the parent (Chat)
// so the picker and the config panel share one request. When that list can't be
// read (a user token 403s on the tenant-scoped library), fall back to a
// free-text field so the user can still name the agent they're entitled to run.
export default function AgentPicker({
  value,
  onChange,
  agents,
  loading,
  error,
  knownAgents = [],
}: Props) {
  if (error) {
    const commit = (raw: string) => {
      const name = raw.trim();
      if (name && name !== value) onChange(name);
    };
    const suggestions = Array.from(new Set(knownAgents.filter(Boolean)));
    return (
      <label className="agent-picker">
        <Bot size={16} />
        <input
          className="agent-freetext"
          list="agent-name-suggestions"
          defaultValue={value}
          placeholder="Agent name…"
          aria-label="Agent name"
          title="Enter the agent to run (the agent list isn't available for this token)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        {suggestions.length > 0 && (
          <datalist id="agent-name-suggestions">
            {suggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
      </label>
    );
  }

  const options = pickableAgents(agents, value);

  return (
    <label className="agent-picker">
      <Bot size={16} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        <option value="" disabled>
          {loading ? "Loading agents…" : "Select an agent"}
        </option>
        {options.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
            {isRetiredAgent(a)
              ? " · retired"
              : a.static_definition?.tier
                ? ` · ${a.static_definition.tier}`
                : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
