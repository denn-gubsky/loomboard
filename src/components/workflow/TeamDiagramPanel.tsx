import { useEffect, useMemo, useState } from "react";
import { useLoomcycle } from "../../state/connection";
import DiagramBlock from "../../chat/components/DiagramBlock";

// The bound team's workflow graph, rendered as a Mermaid state diagram in the
// left panel. `highlightState` (the selected card's status) marks that state
// with a bold outline so the board and the diagram read together. Re-fetches
// when the team or the highlighted state changes.
export default function TeamDiagramPanel({
  team,
  highlightState,
}: {
  team: string;
  highlightState?: string;
}) {
  const client = useLoomcycle();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setError(null);
    (async () => {
      try {
        const d = await client.renderTeamDiagram(team, { highlightState, signal: ac.signal });
        if (!cancelled) setCode(d.diagram);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client, team, highlightState]);

  // Keep the element identity stable across the parent's frequent re-renders
  // (the run-state stream ticks many times/sec while a team runs) so the diagram
  // renders once per source and never re-mounts/blinks.
  const diagram = useMemo(() => (code ? <DiagramBlock code={code} /> : null), [code]);

  if (error) return <div className="wf-error">{error}</div>;
  if (!code) return <div className="wf-dim">Loading diagram…</div>;
  return <div className="wf-diagram">{diagram}</div>;
}
