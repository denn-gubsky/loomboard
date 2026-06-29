import { Bot, AlertCircle } from "lucide-react";
import type { AgentEntry } from "../hooks/useAgents";

interface Props {
  value: string;
  onChange: (name: string) => void;
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
}

// Presentational agent selector. The agent list is fetched by the parent
// (ChatPane) so the picker and the config panel share one request.
export default function AgentPicker({
  value,
  onChange,
  agents,
  loading,
  error,
}: Props) {
  if (error) {
    return (
      <span className="agent-picker error">
        <AlertCircle size={15} /> {error}
      </span>
    );
  }

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
        {agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
            {a.static_definition?.tier ? ` · ${a.static_definition.tier}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
