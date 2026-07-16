import { useEffect, useState } from "react";
import type {
  LibraryAgentDefinition,
  LibraryEntry,
  LoomcycleClient,
} from "@loomcycle/client";
import { describeError } from "../lib/errors";

// The library rows carry the soft-reclaim status the loomcycle server sends (its
// own "Hide retired" filter reads it), but the SDK's LibraryEntry type doesn't
// declare it yet — widen locally. The field is present in the JSON at runtime.
export type AgentEntry = LibraryEntry<LibraryAgentDefinition> & {
  active_retired?: boolean;
};

interface AgentsResult {
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
}

/** Agents pickable in the dropdown: retired ones are hidden, except the
 *  currently-selected agent (`selected`) — a chat already on a since-retired
 *  agent must still show its selection rather than silently switch. Pure. */
export function pickableAgents(agents: AgentEntry[], selected: string): AgentEntry[] {
  return agents.filter((a) => !a.active_retired || a.name === selected);
}

/** Fetch the runtime's library agents once per client. */
export function useAgents(client: LoomcycleClient): AgentsResult {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .listLibraryAgents()
      .then((r) => {
        if (cancelled) return;
        setAgents(r.entries);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(describeError(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { agents, loading, error };
}
