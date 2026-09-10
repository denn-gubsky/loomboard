import { useEffect, useMemo, useState } from "react";
import { WorkflowCanvas, type TeamSummary } from "@loomboard/workflow";
import "@loomboard/workflow/styles.css";
import { useLoomcycle } from "../../state/connection";
import { workflowDataLayer } from "../../lib/workflowCanvasData";

// The Canvas surface (RFC CZ P0): a graph editor for TeamDef workflows.
//
// This is the FIRST consumer of @loomboard/workflow and exists partly to keep
// the package honest — it is developed here, published to npm, and only then
// integrated into loomcycle's own console, so if the injected data layer is
// awkward to bind we find out in this file rather than in the other repo.
//
// Deliberately thin: team selection and nothing else. Everything about the
// graph — editing, validation, layout, save — belongs to the package.

export default function CanvasArea() {
  const client = useLoomcycle();
  const dataLayer = useMemo(() => workflowDataLayer(client), [client]);

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
