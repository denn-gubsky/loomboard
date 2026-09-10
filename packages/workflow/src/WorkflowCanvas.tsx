import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { autoLayout, needsAutoLayout } from "./lib/layout";
import { edgeId, toFlowEdges, toFlowNodes } from "./lib/flow";
import {
  fromDefinition,
  patchHandler,
  toDefinition,
  type CanvasModel,
  type Json,
} from "./lib/model";
import { canSave, validateModel } from "./lib/validate";
import { StateNode } from "./nodes/StateNode";
import type { SavedTeam, WorkflowCanvasProps } from "./types";

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

  const findings = useMemo(() => (model ? validateModel(model) : []), [model]);
  const flowNodes = useMemo(
    () => (model ? toFlowNodes(model, findings, selectedId) : []),
    [model, findings, selectedId],
  );
  const flowEdges = useMemo(() => (model ? toFlowEdges(model, findings) : []), [model, findings]);

  const selected = useMemo(
    () => model?.nodes.find((n) => n.id === selectedId) ?? null,
    [model, selectedId],
  );

  // ---- graph edits ----
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readonly) return;
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
    [readonly],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (readonly || !c.source || !c.target) return;
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
    [readonly],
  );

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (readonly) return;
      const gone = new Set(deleted.map((e) => e.id));
      setModel((m) =>
        m ? { ...m, edges: m.edges.filter((e) => !gone.has(edgeId(e))) } : m,
      );
    },
    [readonly],
  );

  const onNodesDelete = useCallback(
    (deleted: { id: string }[]) => {
      if (readonly) return;
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
    [readonly],
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
    if (readonly) return;
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
  }, [readonly]);

  const relayout = useCallback(() => {
    if (readonly) return;
    setModel((m) => {
      if (!m) return m;
      const pos = autoLayout(m);
      return {
        ...m,
        layoutDirty: true,
        nodes: m.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
      };
    });
  }, [readonly]);

  // ---- save ----
  const save = useCallback(async () => {
    if (!model || readonly) return;
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
  }, [dataLayer, model, onSaved, readonly]);

  const errorCount = findings.filter((f) => f.level === "error").length;
  const saveable = !!model && canSave(findings) && !busy;

  return (
    <div
      className={["loomboard-workflow", className].filter(Boolean).join(" ")}
      data-theme={theme}
    >
      <div className="lb-wf-toolbar">
        <strong className="lb-wf-toolbar__name">{loadedName.current ?? "—"}</strong>
        {!readonly && (
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
        <span className="lb-wf-toolbar__spacer" />
        {errorCount > 0 && (
          <span className="lb-wf-badge lb-wf-badge--error">
            {errorCount} {errorCount === 1 ? "problem" : "problems"}
          </span>
        )}
        {status && <span className="lb-wf-badge lb-wf-badge--ok">{status}</span>}
      </div>

      {error && <div className="lb-wf-error">{error}</div>}

      <div className="lb-wf-body">
        <div className="lb-wf-graph">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={!readonly}
            nodesConnectable={!readonly}
            elementsSelectable
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {!readonly && (
          <Inspector
            node={selected}
            findings={findings}
            agentNames={agentNames}
            disabled={busy}
            onPatch={onPatch}
            onRename={onRename}
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
