import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TEAM_TEMPLATES,
  WorkflowCanvas,
  type DocumentTarget,
  type RunChatTarget,
  type SavedTeam,
  type TeamSummary,
  type TeamTemplate,
} from "@loomboard/workflow";
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
// Deliberately thin: team selection (an existing team, or a new one from a
// template), plus the one thing the package cannot carry — a chat for a member
// run in Run mode. Everything about the graph — editing, validation, layout,
// save — belongs to the package.

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
  // A new team being built: not on the runtime until its first save. `n`
  // makes picking the same template twice a fresh canvas.
  const [draft, setDraft] = useState<{ template: TeamTemplate; n: number }>();
  // A save under a new name (a new team's first, or "Save as new team") opens
  // that team.
  const onSaved = useCallback((saved: SavedTeam) => {
    setDraft(undefined);
    setSelected(saved.name);
    setReloadKey((k) => k + 1);
  }, []);

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
            value={draft ? "" : (selected ?? "")}
            onChange={(e) => {
              setDraft(undefined);
              setSelected(e.target.value || undefined);
            }}
            disabled={loading || !teams.length}
          >
            {!teams.length && <option value="">{loading ? "loading…" : "no teams"}</option>}
            {draft && teams.length > 0 && <option value="">(new team, not saved)</option>}
            {teams.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.latest_version ? ` (v${t.latest_version})` : ""}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="New team"
          value=""
          onChange={(e) => {
            const template = TEAM_TEMPLATES.find((t) => t.id === e.target.value);
            if (template) setDraft((d) => ({ template, n: (d?.n ?? 0) + 1 }));
          }}
        >
          <option value="">New team…</option>
          {TEAM_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.hint}
            </option>
          ))}
        </select>
        {error && <span className="canvas-area__error">{error}</span>}
      </header>

      {draft ? (
        <WorkflowCanvas
          key={`new:${draft.template.id}:${draft.n}`}
          dataLayer={dataLayer}
          template={draft.template.definition}
          onSaved={onSaved}
          renderRunChat={connection ? renderRunChat : undefined}
          onOpenDocument={onOpenDocument}
        />
      ) : selected ? (
        <WorkflowCanvas
          // Remounting on the team name is intentional: the canvas holds the
          // loaded graph and its stale-parent baseline, and switching teams
          // must not carry either across.
          key={selected}
          dataLayer={dataLayer}
          teamName={selected}
          onSaved={onSaved}
          renderRunChat={connection ? renderRunChat : undefined}
          onOpenDocument={onOpenDocument}
        />
      ) : (
        !loading && (
          <p className="canvas-area__empty">
            No teams on this runtime yet. Start one with <strong>New team…</strong> above.
          </p>
        )
      )}
    </div>
  );
}
