import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkflowCanvas, type DocumentTarget, type RunChatTarget, type TeamSummary } from "@loomboard/workflow";
import "@loomboard/workflow/styles.css";
import { useConnection, useLoomcycle } from "../../state/connection";
import { buildConnection } from "../../lib/buildConnection";
import { RunChatPane } from "./RunChatPane";
import { workflowDataLayer } from "../../lib/workflowCanvasData";

// The Canvas surface (RFC CZ P0): a graph editor for TeamDef workflows.
//
// This is the FIRST consumer of @loomboard/workflow and exists partly to keep
// the package honest — it is developed here, published to npm, and only then
// integrated into loomcycle's own console, so if the injected data layer is
// awkward to bind we find out in this file rather than in the other repo.
//
// Deliberately thin: team selection, plus the one thing the package cannot
// carry — a chat for a member run in Run mode. Everything about the graph —
// editing, validation, layout, save — belongs to the package.

export default function CanvasArea({ onOpenDocument }: { onOpenDocument?: (target: DocumentTarget) => void }) {
  const client = useLoomcycle();
  const dataLayer = useMemo(() => workflowDataLayer(client), [client]);
  // Run mode's chat for a member run: the app's own <Chat>, which the package
  // does not carry (it renders whatever the host gives it).
  const { settings } = useConnection();
  const connection = useMemo(() => (settings ? buildConnection(settings) : null), [settings]);
  const renderRunChat = useCallback(
    (target: RunChatTarget) => (connection ? <RunChatPane connection={connection} client={client} target={target} /> : null),
    [connection, client],
  );

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  // Bumped after a save so the team list picks up the new version count.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dataLayer
      .listTeams()
      .then((list) => {
        if (cancelled) return;
        setTeams(list);
        setError(undefined);
        // Open the first team automatically: an empty canvas with a dropdown
        // is a worse first impression than a real graph.
        setSelected((cur) => cur ?? list[0]?.name);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dataLayer, reloadKey]);

  return (
    <div className="canvas-area">
      <header className="canvas-area__bar">
        <label>
          Team{" "}
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value || undefined)}
            disabled={loading || !teams.length}
          >
            {!teams.length && <option value="">{loading ? "loading…" : "no teams"}</option>}
            {teams.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.latest_version ? ` (v${t.latest_version})` : ""}
              </option>
            ))}
          </select>
        </label>
        {error && <span className="canvas-area__error">{error}</span>}
      </header>

      {selected ? (
        <WorkflowCanvas
          // Remounting on the team name is intentional: the canvas holds the
          // loaded graph and its stale-parent baseline, and switching teams
          // must not carry either across.
          key={selected}
          dataLayer={dataLayer}
          teamName={selected}
          onSaved={() => setReloadKey((k) => k + 1)}
          renderRunChat={connection ? renderRunChat : undefined}
          onOpenDocument={onOpenDocument}
        />
      ) : (
        !loading && (
          <p className="canvas-area__empty">
            No teams on this runtime yet. Create one with the <code>TeamDef</code> tool, then
            reload.
          </p>
        )
      )}
    </div>
  );
}
