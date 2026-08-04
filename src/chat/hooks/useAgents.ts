import { useEffect, useState } from "react";
import type {
  LibraryAgentDefinition,
  LibraryEntry,
  LoomcycleClient,
} from "@loomcycle/client";
import { describeError } from "../lib/errors";

// The library rows carry the soft-reclaim status the loomcycle server sends (its
// own "Hide retired" filter reads it), but the SDK's LibraryEntry type doesn't
// declare these fields yet — widen locally. They're present in the JSON at
// runtime. `live_version_count` is `version_count` minus retired versions; it's
// `omitempty`, so 0 (every version retired) arrives ABSENT, not as 0.
export type AgentEntry = LibraryEntry<LibraryAgentDefinition> & {
  /** The active version points at a retired def. */
  active_retired?: boolean;
  /** Non-retired version count; absent when 0 (all versions retired). */
  live_version_count?: number;
};

interface AgentsResult {
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
}

/** Whether an agent is retired and shouldn't be offered for a new chat. Two
 *  loomcycle retirement paths: the active version is retired, OR (for a
 *  dynamic-only agent with no static fallback) every version is retired
 *  (`version_count > 0` but no live ones). A static/both agent keeps its static
 *  definition, so it's only hidden when the active version itself is retired. */
export function isRetiredAgent(a: AgentEntry): boolean {
  if (a.active_retired) return true;
  return !a.in_static && a.version_count > 0 && !a.live_version_count;
}

/** Agents pickable in the dropdown: retired ones are hidden, except the
 *  currently-selected agent (`selected`) — a chat already on a since-retired
 *  agent must still show its selection rather than silently switch. Pure. */
export function pickableAgents(agents: AgentEntry[], selected: string): AgentEntry[] {
  return agents.filter((a) => !isRetiredAgent(a) || a.name === selected);
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
