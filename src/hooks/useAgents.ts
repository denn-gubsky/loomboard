import { useEffect, useState } from "react";
import type { LibraryAgentDefinition, LibraryEntry } from "@loomcycle/client";
import { useLoomcycle } from "../state/connection";
import { describeError } from "../lib/loomcycle";

export type AgentEntry = LibraryEntry<LibraryAgentDefinition>;

interface AgentsResult {
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
}

/** Fetch the runtime's library agents once per connected client. */
export function useAgents(): AgentsResult {
  const client = useLoomcycle();
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
