import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import { Inspector } from "./inspector/Inspector";
import { PublishComposer } from "./PublishComposer";
import { autoLayout, needsAutoLayout } from "./lib/layout";
import { edgeId, toDataEdges, toFlowEdges, toFlowNodes } from "./lib/flow";
import {
  fromDefinition,
  patchHandler,
  teamChannels,
  toDefinition,
  type CanvasModel,
  type Json,
  type TeamChannels,
} from "./lib/model";
import { canSave, validateModel } from "./lib/validate";
import {
  INITIAL as SESSION_INITIAL,
  abortAvailability,
  canEditGraph,
  canReturnToEdit,
  canStart,
  isLive,
  reduce as reduceSession,
  statusLabel,
} from "./lib/session";
import { StateNode } from "./nodes/StateNode";
import { handlerChannels } from "./lib/model";
import type { ChannelInfo, SavedTeam, WorkflowCanvasProps } from "./types";

const NODE_TYPES = { state: StateNode };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function WorkflowCanvasInner({
  dataLayer,
  teamName,
  defId,
  mode = "edit",
  onSaved,
  theme,
  className,
}: WorkflowCanvasProps) {
  const [model, setModel] = useState<CanvasModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** The def_id this graph was loaded from. RFC CZ decision 6: a save whose
   *  parent is no longer the active pointer is REFUSED rather than silently
   *  overwriting whoever moved it. */
  const parentDefId = useRef<string | null>(null);
  const loadedName = useRef<string | null>(null);

  const readonly = mode === "readonly";

  // The session machine (C5) owns which mode the surface is in; `readonly` is
  // the HOST's separate say in whether this embed edits at all. Both must
  // allow it, so every edit path below gates on `editable` rather than on
  // either one alone.
  const [session, dispatchSession] = useReducer(reduceSession, SESSION_INITIAL);
  const editable = !readonly && canEditGraph(session);

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(undefined);
      setStatus(undefined);
      try {
        const detail = defId
          ? await dataLayer.getTeamDef(defId)
          : teamName
            ? await dataLayer.getActiveTeamDef(teamName)
            : null;
        if (cancelled || !detail) return;
        let next = fromDefinition(detail.definition);
        // Auto-layout on open, but do NOT mark the model dirty: merely opening
        // a team that has no stored layout must never fork it.
        if (needsAutoLayout(next)) {
          const pos = autoLayout(next);
          next = { ...next, nodes: next.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) };
        }
        parentDefId.current = detail.def_id;
        loadedName.current = detail.name;
        // The promoted pointer, for C7's "a publish runs the PROMOTED version"
        // warning. Best-effort: a host without listTeams simply loses the
        // warning rather than the composer.
        dataLayer
          .listTeams()
          .then((list) => {
            if (!cancelled) setActiveDefId(list.find((t) => t.name === detail.name)?.active_def_id);
          })
          .catch(() => undefined);
        setModel(next);
        setSelectedId(null);
      } catch (e) {
        if (!cancelled) setError(`Failed to load: ${msg(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataLayer, teamName, defId]);

  useEffect(() => {
    let cancelled = false;
    dataLayer
      .listAgents?.()
      .then((names) => !cancelled && setAgentNames(names))
      // A missing agent list degrades the picker to free text; it must never
      // block the canvas from opening.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataLayer]);

  const [channels, setChannels] = useState<ChannelInfo[]>();
  const [activeDefId, setActiveDefId] = useState<string>();
  const [composing, setComposing] = useState(false);

  // The channel the ENTRY state reads — the workflow's front door (C7). Only a
  // Starter has one; every other entry kind is run through the Run button.
  const entryChannel = useMemo(() => {
    if (!model?.entry) return "";
    const entry = model.nodes.find((n) => n.id === model.entry);
    return entry ? (handlerChannels(entry).source ?? "") : "";
  }, [model]);

  useEffect(() => {
    if (!entryChannel || !dataLayer.listChannels) return;
    let cancelled = false;
    dataLayer
      .listChannels()
      .then((list) => !cancelled && setChannels(list))
      // A channel list we cannot fetch must not block publishing — the
      // pre-flight treats "not loaded" differently from "not declared".
      .catch(() => !cancelled && setChannels(undefined));
    return () => {
      cancelled = true;
    };
  }, [dataLayer, entryChannel]);

  const findings = useMemo(() => (model ? validateModel(model) : []), [model]);
  const flowNodes = useMemo(
    () => (model ? toFlowNodes(model, findings, selectedId) : []),
    [model, findings, selectedId],
  );
  // Control edges and the DERIVED data edges, in one array because xyflow takes
  // one. Data edges come second so a control edge wins the z-order where they
  // overlap: the walk's own graph is what an operator is editing, and the
  // channel wiring is context for it (decision C1).
  const flowEdges = useMemo(
    () => (model ? [...toFlowEdges(model, findings), ...toDataEdges(model)] : []),
    [model, findings],
  );

  const selected = useMemo(
    () => model?.nodes.find((n) => n.id === selectedId) ?? null,
    [model, selectedId],
  );

  // ---- graph edits ----
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!editable) return;
      setModel((m) => {
        if (!m) return m;
        let dirty = m.layoutDirty;
        let nodes = m.nodes;
        for (const c of changes) {
          if (c.type === "position" && c.position) {
            // Only a COMPLETED drag dirties the layout. Intermediate frames
            // would mark a definition changed the moment a pointer twitched.
            if (c.dragging === false) dirty = true;
            const pos = c.position;
            nodes = nodes.map((n) => (n.id === c.id ? { ...n, position: pos } : n));
          } else if (c.type === "select" && c.selected) {
            setSelectedId(c.id);
          }
        }
        return nodes === m.nodes && dirty === m.layoutDirty ? m : { ...m, nodes, layoutDirty: dirty };
      });
    },
    [editable],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !c.source || !c.target) return;
      setModel((m) => {
        if (!m) return m;
        // A state's outbound labels must be unique, so a second edge from the
        // same source defaults to a distinct pushback rather than a duplicate
        // `success` the validator would immediately refuse.
        const used = new Set(m.edges.filter((e) => e.from === c.source).map((e) => e.on));
        const on = used.has("success") ? `pushback:${c.target}` : "success";
        if (used.has(on)) return m;
        return {
          ...m,
          edges: [
            ...m.edges,
            { from: c.source!, to: c.target!, on, raw: { from: c.source!, to: c.target!, on } },
          ],
        };
      });
    },
    [editable],
  );

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (!editable) return;
      const gone = new Set(deleted.map((e) => e.id));
      setModel((m) =>
        m ? { ...m, edges: m.edges.filter((e) => !gone.has(edgeId(e))) } : m,
      );
    },
    [editable],
  );

  const onNodesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (!editable) return;
      const gone = new Set(deleted.map((n) => n.id));
      setModel((m) =>
        m
          ? {
              ...m,
              nodes: m.nodes.filter((n) => !gone.has(n.id)),
              // Drop the transitions that would otherwise dangle.
              edges: m.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
            }
          : m,
      );
      setSelectedId(null);
    },
    [editable],
  );

  const onPatch = useCallback(
    (fields: Record<string, Json | undefined>) => {
      setModel((m) =>
        m
          ? { ...m, nodes: m.nodes.map((n) => (n.id === selectedId ? patchHandler(n, fields) : n)) }
          : m,
      );
    },
    [selectedId],
  );

  const onChannelsChange = useCallback((next: TeamChannels) => {
    setModel((m) => (m ? { ...m, channelsPatch: next } : m));
  }, []);

  const onRename = useCallback(
    (next: string) => {
      setModel((m) => {
        if (!m || !selectedId) return m;
        return {
          ...m,
          entry: m.entry === selectedId ? next : m.entry,
          nodes: m.nodes.map((n) =>
            n.id === selectedId
              ? { ...n, id: next, statePatch: { ...(n.statePatch ?? {}), state: next } }
              : n,
          ),
          // A rename has to carry the transitions with it, or every edge the
          // node was part of silently stops resolving.
          edges: m.edges.map((e) =>
            e.from === selectedId || e.to === selectedId
              ? {
                  ...e,
                  from: e.from === selectedId ? next : e.from,
                  to: e.to === selectedId ? next : e.to,
                  raw: {
                    ...e.raw,
                    from: e.from === selectedId ? next : e.from,
                    to: e.to === selectedId ? next : e.to,
                  },
                }
              : e,
          ),
        };
      });
      setSelectedId(next);
    },
    [selectedId],
  );

  const addState = useCallback(() => {
    if (!editable) return;
    setModel((m) => {
      if (!m) return m;
      let i = m.nodes.length + 1;
      while (m.nodes.some((n) => n.id === `state-${i}`)) i++;
      const id = `state-${i}`;
      const raw = { state: id, handler: { kind: "agent", agent: "" } };
      return {
        ...m,
        layoutDirty: true,
        nodes: [
          ...m.nodes,
          { id, kind: "agent", opaque: false, position: { x: 40, y: 40 }, raw },
        ],
      };
    });
  }, [editable]);

  const relayout = useCallback(() => {
    if (!editable) return;
    setModel((m) => {
      if (!m) return m;
      const pos = autoLayout(m);
      return {
        ...m,
        layoutDirty: true,
        nodes: m.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
      };
    });
  }, [editable]);

  // ---- save ----
  const save = useCallback(async () => {
    if (!model || !editable) return;
    const name = loadedName.current;
    if (!name) {
      setError("No team loaded.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      // Stale-parent check. Two operators editing one team both fork from the
      // same parent, and without this the second silently wins.
      const current = await dataLayer.getActiveTeamDef(name);
      if (parentDefId.current && current.def_id !== parentDefId.current) {
        setError(
          `This team moved on while you were editing (active version is now ${current.def_id}). ` +
            `Reload to pick up the change — saving would discard it.`,
        );
        return;
      }
      const saved: SavedTeam = await dataLayer.forkTeam(name, toDefinition(model));
      parentDefId.current = saved.def_id;
      setStatus(`Saved version ${saved.version}.`);
      // The saved graph IS the new baseline, so a subsequent save is not a
      // no-op fork of a stale parent.
      setModel((m) => (m ? { ...m, layoutDirty: false } : m));
      onSaved?.(saved);
    } catch (e) {
      setError(`Save failed: ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  }, [dataLayer, model, onSaved, editable]);

  // ---- running ----
  const startRun = useCallback(async () => {
    if (!model || !dataLayer.runTeamDetached || !canStart(session)) return;
    const name = loadedName.current;
    if (!name) {
      setError("No team loaded.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      // By def_id, never by name: Save-then-Run would otherwise execute the
      // PREVIOUS version, and the difference is invisible on screen.
      const started = await dataLayer.runTeamDetached({ defId: parentDefId.current ?? undefined });
      if (!started?.run_id) {
        // A host that quietly fell back to a blocking run returns a trace with
        // no handle. Refusing is the honest outcome: every live surface in Run
        // mode addresses that run id, so without one there is nothing to show.
        setError(
          "This runtime started the walk without returning a run id, so it cannot be " +
            "monitored or stopped. It needs loomcycle #1206 or newer.",
        );
        return;
      }
      dispatchSession({ t: "start", runId: started.run_id, debug: false });
      setStatus(`Running (${started.run_id}).`);
    } catch (e) {
      setError(`Could not start the run: ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  }, [dataLayer, model, session]);

  const backToEdit = useCallback(() => {
    // Explicit, and it DISCARDS the trace — never automatic on finish, because
    // the most useful moment to read a failed run is right after it fails.
    dispatchSession({ t: "toEdit" });
    setStatus(undefined);
  }, []);

  const abort = abortAvailability(session);

  const errorCount = findings.filter((f) => f.level === "error").length;
  const saveable = !!model && canSave(findings) && !busy;

  return (
    <div
      className={["loomboard-workflow", className].filter(Boolean).join(" ")}
      data-theme={theme}
    >
      <div className="lb-wf-toolbar">
        <strong className="lb-wf-toolbar__name">{loadedName.current ?? "—"}</strong>
        {!readonly && editable && (
          <>
            <button className="lb-wf-btn" onClick={addState} disabled={!model}>
              Add state
            </button>
            <button className="lb-wf-btn" onClick={relayout} disabled={!model}>
              Auto-layout
            </button>
            <button className="lb-wf-btn lb-wf-btn--primary" onClick={save} disabled={!saveable}>
              {busy ? "Saving…" : "Save new version"}
            </button>
          </>
        )}

        {!readonly && dataLayer.runTeamDetached && canStart(session) && (
          <button
            className="lb-wf-btn"
            onClick={startRun}
            disabled={!model || busy || errorCount > 0}
            title={
              errorCount > 0
                ? "Fix the validation problems first — the runtime would refuse this definition."
                : "Start this version, detached"
            }
          >
            Run
          </button>
        )}

        {isLive(session) &&
          (abort.available ? (
            <button className="lb-wf-btn" onClick={() => dispatchSession({ t: "ended", status: "aborted" })}>
              Abort
            </button>
          ) : (
            // Shown-and-disabled rather than hidden: "why can I not stop this"
            // is the question an operator will actually have, and the tooltip
            // is the answer. See abortAvailability for the verified reason.
            <button className="lb-wf-btn" disabled title={abort.reason}>
              Abort
            </button>
          ))}

        {entryChannel && dataLayer.publishChannel && (
          <button
            className="lb-wf-btn"
            onClick={() => setComposing((c) => !c)}
            title={`Publish a message to ${entryChannel} — the entry Starter reads it`}
          >
            {composing ? "Hide publish" : "Publish\u2026"}
          </button>
        )}

        {canReturnToEdit(session) && (
          <button
            className="lb-wf-btn"
            onClick={backToEdit}
            title="Discards the run trace and reloads the active version."
          >
            Back to Edit
          </button>
        )}

        <span className="lb-wf-toolbar__spacer" />
        <span className={`lb-wf-phase lb-wf-phase--${session.phase}`}>{statusLabel(session)}</span>
        {errorCount > 0 && (
          <span className="lb-wf-badge lb-wf-badge--error">
            {errorCount} {errorCount === 1 ? "problem" : "problems"}
          </span>
        )}
        {status && <span className="lb-wf-badge lb-wf-badge--ok">{status}</span>}
      </div>

      {error && <div className="lb-wf-error">{error}</div>}

      {composing && entryChannel && dataLayer.publishChannel && (
        <PublishComposer
          channel={entryChannel}
          info={channels?.find((c) => c.name === entryChannel)}
          channelsLoaded={channels !== undefined}
          loadedDefId={parentDefId.current ?? undefined}
          activeDefId={activeDefId}
          disabled={busy}
          onPublish={async (payload, scope) => {
            await dataLayer.publishChannel!(entryChannel, payload, { scope });
          }}
          onClose={() => setComposing(false)}
        />
      )}

      <div className="lb-wf-body">
        <div className={`lb-wf-graph${editable ? "" : " is-locked"}`}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              ariaLabel="Workflow overview"
              // nodeClassName rather than nodeColor: the minimap's node fills
              // then live in styles.css alongside every other colour, so they
              // follow the theme instead of needing a palette hardcoded here
              // that would drift. Without ANY of this the default fill is a
              // near-white grey on a white mask — the minimap renders as an
              // empty box, which is how it shipped.
              nodeClassName={(n) => {
                const d = n.data as unknown as { node?: { kind?: string; opaque?: boolean } };
                if (d?.node?.opaque) return "is-opaque";
                return `is-${d?.node?.kind || "unset"}`;
              }}
            />
          </ReactFlow>
        </div>

        {!readonly && (
          <Inspector
            node={selected}
            findings={findings}
            agentNames={agentNames}
            disabled={busy || !editable}
            onPatch={onPatch}
            onRename={onRename}
            channels={model ? teamChannels(model) : undefined}
            onChannelsChange={onChannelsChange}
          />
        )}
      </div>

      {findings.length > 0 && (
        <ul className="lb-wf-findings">
          {findings.map((f, i) => (
            <li key={i} className={`lb-wf-finding lb-wf-finding--${f.level}`}>
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The canvas. Wrapped in ReactFlowProvider so a host can mount more than one
 *  without their viewports fighting. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
