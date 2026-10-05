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
import { Palette } from "./Palette";
import { newStateRaw, type PaletteEntry } from "./lib/palette";
import { fieldsPatch, inputFields, placeInput, startFindings, startPlan, type FormResult } from "./lib/inputForm";
import { InputDialog } from "./InputDialog";
import { walkProgress, type WalkProgress } from "./lib/progress";
import { useRunLines } from "./useRunLines";
import { LOCAL_KINDS, localKind, localNames, teamOwnEntries, teamVars, type LocalKind } from "./lib/teamLocal";
import { addLocal, localBodyFindings, localNameError, removeLocal, setLocal } from "./lib/localEdit";
import { RunChatColumn } from "./RunChatColumn";
import { InputFieldsPanel } from "./inspector/InputFieldsPanel";
import { ResultPanel } from "./inspector/ResultPanel";
import { autoLayout, needsAutoLayout, withLayout } from "./lib/layout";
import {
  edgeId,
  mergeMeasured,
  toAgentFlowNodes,
  toBindingEdges,
  toBindingFlowNodes,
  toVariableEdges,
  toVariableFlowNodes,
  toChannelFlowNodes,
  toDataEdges,
  markTaken,
  toFlowEdges,
  toFlowNodes,
  visibleEdges,
} from "./lib/flow";
import { bindingFindings, bindingNodeId, bindingNodes } from "./lib/bindings";
import {
  emptyWalk,
  liveRunByState,
  foldWalk,
  isTerminal,
  pulseLabel,
  rowsForState,
  statePulses,
  walkSignal,
  type WalkRunRow,
  type WalkView,
} from "./lib/runs";
import { outputChannels, walkResult, type ResultItem } from "./lib/output";
import { OutputPanel } from "./OutputPanel";
import { RunsPanel } from "./inspector/RunsPanel";
import { BindingNode } from "./nodes/BindingNode";
import { VariableNode } from "./nodes/VariableNode";
import { applyDataWire, bindingRefError, dataConnection, losesHandoff, placeBinding, planDataWire, removeBinding } from "./lib/dataWiring";
import {
  declareVariable,
  nextVariableName,
  setVariableDefault,
  undeclareVariable,
  variableFindings,
  variableNodeId,
  variableNodes,
} from "./lib/variables";
import { channelNodes } from "./lib/channelNodes";
import { agentNodes, agentOwner, dispatchesAgent } from "./lib/agentNodes";
import { AgentNode } from "./nodes/AgentNode";
import { channelsInUse, withGrant, type ChannelSide } from "./lib/channels";
import { applyWire, connectionKind, placeChannel, planWire, removeChannel, transitionSource } from "./lib/channelWiring";
import { ChannelNode } from "./nodes/ChannelNode";
import {
  contentKey,
  fromDefinition,
  patchHandler,
  teamChannels,
  toDefinition,
  walkHooks,
  type CanvasModel,
  type Json,
  type JsonObject,
  type TeamChannels,
} from "./lib/model";
import { canSave, isInputStarter, validateModel } from "./lib/validate";
import { aclFindings } from "./lib/channels";
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

const NODE_TYPES = { state: StateNode, channel: ChannelNode, binding: BindingNode, agent: AgentNode, variable: VariableNode };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function WorkflowCanvasInner({
  dataLayer,
  teamName,
  defId,
  mode = "edit",
  onSaved,
  theme,
  className,
  renderRunChat,
  onOpenDocument,
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
  // The CONTENT last loaded or saved (lib/model contentKey). Run starts that
  // saved version, so any difference means Start would not run what is shown.
  const savedKey = useRef<string>("");
  const loadedName = useRef<string | null>(null);

  const readonly = mode === "readonly";

  // The session machine (C5) owns which mode the surface is in; `readonly` is
  // the HOST's separate say in whether this embed edits at all. Both must
  // allow it, so every edit path below gates on `editable` rather than on
  // either one alone.
  const [session, dispatchSession] = useReducer(reduceSession, SESSION_INITIAL);

  // ---- the live walk (M3) ----
  // Folded from the host's watchWalk: the walk's own run plus every run it
  // started. Kept after the walk ends, so the trace stays readable in the mode
  // that produced it (C5), and dropped when the operator goes back to Edit.
  const [walk, setWalk] = useState<WalkView>();
  useEffect(() => {
    const runId = session.runId;
    if (!runId || !dataLayer.watchWalk) {
      setWalk(undefined);
      return;
    }
    setWalk(emptyWalk(runId));
    return dataLayer.watchWalk(
      runId,
      (rows) => setWalk((v) => (v && v.walkRunId === runId ? foldWalk(v, rows) : v)),
      // The watcher reconnects on its own; an error is worth a log, not a stop.
      (e) => console.warn("[canvas] walk stream error (reconnecting):", e),
    );
  }, [dataLayer, session.runId]);

  // The walk's OWN run drives the session: it ending ends the session (so
  // Back to Edit appears — the canvas used to stay "Running" forever), and it
  // waiting on an Interruption is the before_dispatch pause. A ref holds the
  // previous row so each change is signalled once.
  const lastWalkRow = useRef<WalkRunRow | undefined>(undefined);
  useEffect(() => {
    const next = walk?.walk;
    const signal = walkSignal(lastWalkRow.current, next);
    lastWalkRow.current = next;
    if (signal) dispatchSession(signal);
  }, [walk?.walk]);

  // What a COMPLETED walk produced, for its End node: read from the walk's
  // own run (RFC DI — the run holds the output), once it has finished.
  const [result, setResult] = useState<{ walkRunId: string; terminal?: string; items: ResultItem[] }>();
  const walkDone = walk?.walk?.status === "completed" ? walk.walkRunId : undefined;
  useEffect(() => {
    if (!walkDone || !dataLayer.readRun) {
      setResult(undefined);
      return;
    }
    let cancelled = false;
    dataLayer
      .readRun(walkDone)
      .then((d) => !cancelled && setResult({ walkRunId: walkDone, terminal: d.terminal, items: walkResult(d.finalText) }))
      .catch((e) => console.warn("[canvas] reading the walk's result failed:", e));
    return () => {
      cancelled = true;
    };
  }, [dataLayer, walkDone]);
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
        if (needsAutoLayout(next)) next = withLayout(next, autoLayout(next), false);
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
        savedKey.current = contentKey(next);
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
  // The Input node's Start dialog (RFC CZ "The Input node").
  const [startOpen, setStartOpen] = useState(false);
  const [startError, setStartError] = useState<string>();
  // What xyflow measured, fed back in so the MiniMap has dimensions to draw.
  // Presentation-only: it never reaches the definition.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  // The channel the ENTRY state reads — the workflow's front door (C7). Only a
  // Starter has one; every other entry kind is run through the Run button.
  const entryChannel = useMemo(() => {
    if (!model?.entry) return "";
    const entry = model.nodes.find((n) => n.id === model.entry);
    return entry ? (handlerChannels(entry).source ?? "") : "";
  }, [model]);

  // Listed whenever the graph names ANY channel, not only for the entry's
  // front door: every channel node shows whether it is declared, held or
  // hooked, and that comes from here.
  const namesChannels = useMemo(
    // Also while editing: placing a channel offers the declared names.
    () => !!model && (editable || channelsInUse(model).length > 0),
    [model, editable],
  );

  useEffect(() => {
    if (!(entryChannel || namesChannels) || !dataLayer.listChannels) return;
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
  }, [dataLayer, entryChannel, namesChannels]);

  // The graph's own rules PLUS the team ACL. They come from different places
  // on the runtime — validateModel mirrors teamgraph.Validate, while the ACL
  // check lives in the TeamDef tool's create/fork preflight — but both refuse a
  // save, so the operator sees one list.
  const findings = useMemo(
    () =>
      model
        ? [
            ...validateModel(model),
            ...aclFindings(model),
            ...bindingFindings(model),
            ...startFindings(model),
            ...variableFindings(variableNodes(model)),
            ...localBodyFindings(model),
          ]
        : [],
    [model],
  );
  // The channels the graph names, as nodes its data edges route through.
  const channelViews = useMemo(() => (model ? channelNodes(model, channels) : []), [model, channels]);
  // The Documents and Memory the prompts pull in, as nodes feeding them (P3).
  const bindingViews = useMemo(() => (model ? bindingNodes(model) : []), [model]);
  const variableViews = useMemo(() => (model ? variableNodes(model) : []), [model]);
  // Each Starter's agent, as the node between it and its sink (C2 amended).
  const agentViews = useMemo(() => (model ? agentNodes(model) : []), [model]);
  // For onNodesChange, which must not re-create on every model change: an
  // agent node's selection is its Starter's.
  const agentViewsRef = useRef(agentViews);
  agentViewsRef.current = agentViews;
  const pulses = useMemo(() => (walk ? statePulses(walk) : undefined), [walk]);
  // Where a RUNNING walk is; none once it has ended (lib/progress.ts).
  const progress = useMemo(() => (model ? walkProgress(model, walk) : undefined), [model, walk]);
  // The run going in each state, followed live on its node. Empty once the
  // walk has ended, which closes every follow and clears the lines.
  const liveRuns = useMemo(() => (walk ? liveRunByState(walk) : new Map<string, WalkRunRow>()), [walk]);
  const runLines = useRunLines(dataLayer.watchRunLines, liveRuns);
  // Run mode's right column: the selected state's conversation, or Details.
  const [sideTab, setSideTab] = useState<"chat" | "details">("chat");
  useEffect(() => setSideTab("chat"), [selectedId]);
  // What Start does, when the team begins with an Input node.
  const plan = useMemo(() => (model ? startPlan(model) : undefined), [model]);
  // The team's declared variables, offered in the Start dialog. Start runs the
  // SAVED version and is refused while the graph differs from it, so what is
  // on screen is what it declares.
  const savedVars = useMemo(() => (model ? teamVars(model) : {}), [model]);
  const declaresVars = Object.keys(savedVars).length > 0;
  // The team's own agents and channels are offered beside the global ones, as
  // "./name" — the only spelling that means the team's own (RFC DV).
  const agentChoices = useMemo(
    () => [...(model ? localNames(model, "agents").map((n) => `./${n}`) : []), ...(agentNames ?? [])],
    [model, agentNames],
  );
  // Editing the team's own definitions (RFC DV). Content: each forks on save.
  const teamOwnEdit = useMemo(
    () => ({
      bodies: Object.fromEntries(LOCAL_KINDS.map((k) => [k, model ? localKind(model, k) : {}])) as Record<
        LocalKind,
        Record<string, JsonObject>
      >,
      onAdd: (kind: LocalKind, name: string) => {
        const why = model ? localNameError(model, kind, name) : "no team loaded";
        if (!why) setModel((m) => (m ? addLocal(m, kind, name) : m));
        return why;
      },
      onSet: (kind: LocalKind, name: string, body: JsonObject) => setModel((m) => (m ? setLocal(m, kind, name, body) : m)),
      onRemove: (kind: LocalKind, name: string) => setModel((m) => (m ? removeLocal(m, kind, name) : m)),
    }),
    [model],
  );
  const teamOwn = useMemo(
    () => (model ? teamOwnEntries(model, loadedName.current ?? teamName ?? "", agentNames) : []),
    [model, agentNames, teamName],
  );
  const unsaved = useMemo(() => !!model && contentKey(model) !== savedKey.current, [model]);
  const canRun = !readonly && !!dataLayer.runTeamDetached && canStart(session);
  // The End node the result belongs on: the one the runtime says the walk
  // reached (G14), so two endings of one team stay apart.
  const endedAt = result && result.walkRunId === walk?.walkRunId ? result.terminal : undefined;

  // The team's output channels (M3b). Keyed by what the panel uses, so an
  // ordinary graph edit — which rebuilds every view — does not re-peek them.
  const outputsAll = useMemo(() => outputChannels(channelViews), [channelViews]);
  const outputsKey = outputsAll.map((c) => `${c.channel}|${c.info?.scope ?? ""}|${c.declared}`).join(",");
  const outputsRef = useRef({ key: "", value: outputsAll });
  if (outputsRef.current.key !== outputsKey) outputsRef.current = { key: outputsKey, value: outputsAll };
  const outputs = outputsRef.current.value;
  // New output can appear when a run settles, so that is when to re-peek.
  const outputRefresh = walk
    ? `${walk.walk?.status ?? ""}:${[...walk.members.values()].filter((r) => isTerminal(r.status)).length}`
    : "";
  const openStart = useCallback(() => {
    setStartError(undefined);
    setStartOpen(true);
  }, []);
  const flowNodes = useMemo(
    () =>
      model
        ? [
            // A Starter's runs are its agent's: counted on the agent node.
            ...toFlowNodes(model, findings, selectedId, measured).map((n) =>
              pulses?.has(n.id) && !dispatchesAgent(n.data.node)
                ? { ...n, data: { ...n.data, pulse: pulseLabel(pulses.get(n.id)), held: pulses.get(n.id)!.held } }
                : n.id === endedAt && result
                  ? { ...n, data: { ...n.data, result: result.items } }
                  : plan && n.id === plan.input
                    ? { ...n, data: { ...n.data, ...(canRun ? { start: openStart } : {}) } }
                    : n,
            ).map((n) => {
              const p = progressOf(progress, n.id);
              // A Starter's lines show on its agent node, where the run is.
              const lines = dispatchesAgent(n.data.node) ? undefined : runLines.get(n.id);
              return p || lines
                ? { ...n, data: { ...n.data, ...(p ? { progress: p, current: p === "active" } : {}), ...(lines ? { lines } : {}) } }
                : n;
            }),
            ...toAgentFlowNodes(agentViews, selectedId, measured).map((n) => {
              const state = n.data.view.state;
              const p = progressOf(progress, state);
              const lines = runLines.get(state);
              return pulses?.has(state) || p || lines
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      ...(pulses?.has(state) ? { pulse: pulseLabel(pulses.get(state)), held: pulses.get(state)!.held } : {}),
                      ...(p ? { progress: p } : {}),
                      ...(lines ? { lines } : {}),
                    },
                  }
                : n;
            }),
            ...toChannelFlowNodes(channelViews, selectedId, measured),
            ...toBindingFlowNodes(bindingViews, selectedId, measured),
            ...toVariableFlowNodes(variableViews, selectedId, measured),
          ]
        : [],
    [model, findings, selectedId, measured, channelViews, bindingViews, variableViews, agentViews, pulses, progress, runLines, endedAt, result, plan, canRun, openStart],
  );
  // Control edges and the DERIVED data edges, in one array because xyflow takes
  // one. Data edges come second so a control edge wins the z-order where they
  // overlap: the walk's own graph is what an operator is editing, and the
  // channel wiring is context for it (decision C1).
  // Transitions can be switched off so the data row reads alone; they stay in
  // the definition either way. On by default: they are the walk's own graph.
  const [showTransitions, setShowTransitions] = useState(true);
  const flowEdges = useMemo(
    () =>
      model
        ? visibleEdges(
            [
              ...markTaken(toFlowEdges(model, findings), progress?.taken),
              ...toDataEdges(channelViews, agentViews),
              ...toBindingEdges(bindingViews),
              ...toVariableEdges(variableViews),
            ],
            showTransitions,
          )
        : [],
    [model, findings, channelViews, bindingViews, variableViews, agentViews, showTransitions, progress],
  );

  const selected = useMemo(
    () => model?.nodes.find((n) => n.id === selectedId) ?? null,
    [model, selectedId],
  );

  // ---- graph edits ----
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Dimensions first, and OUTSIDE the editable gate: a read-only canvas
      // still needs a minimap, and measuring is not an edit.
      const sized: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) sized[c.id] = c.dimensions;
      }
      if (Object.keys(sized).length) {
        // Same object back when nothing changed — see mergeMeasured; a fresh
        // object every time would loop through xyflow's re-measure.
        setMeasured((prev) => mergeMeasured(prev, sized));
      }

      // Selection too is not an edit, and a LIVE walk is exactly when the
      // operator selects a node to read its runs (M3b). It used to sit behind
      // the gate below, so nothing could be selected while a walk ran.
      for (const c of changes) {
        if (c.type === "select" && c.selected) setSelectedId(agentOwner(agentViewsRef.current, c.id) ?? c.id);
      }

      if (!editable) return;
      setModel((m) => {
        if (!m) return m;
        let dirty = m.layoutDirty;
        let nodes = m.nodes;
        let derivedPositions = m.derivedPositions;
        const states = new Set(m.nodes.map((n) => n.id));
        for (const c of changes) {
          if (c.type === "position" && c.position) {
            // Only a COMPLETED drag dirties the layout. Intermediate frames
            // would mark a definition changed the moment a pointer twitched.
            if (c.dragging === false) dirty = true;
            const pos = c.position;
            if (states.has(c.id)) {
              nodes = nodes.map((n) => (n.id === c.id ? { ...n, position: pos } : n));
            } else {
              // A derived node (channel, agent): its position is presentation
              // too, kept beside the states' in layout.nodes under its key.
              derivedPositions = { ...(derivedPositions ?? {}), [c.id]: pos };
            }
          }
        }
        return nodes === m.nodes && dirty === m.layoutDirty && derivedPositions === m.derivedPositions
          ? m
          : { ...m, nodes, derivedPositions, layoutDirty: dirty };
      });
    },
    [editable],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !c.source || !c.target) return;
      // A data node dragged onto a state: its token goes into that state's
      // user input. Said out loud when it costs the state its hand-off.
      if (model) {
        const w = planDataWire(model, c, variableNodes(model), bindingNodes(model));
        if (w && losesHandoff(model, w)) {
          setStatus(
            `"${w.state}" now has its own input, so it no longer receives the previous state's output ` +
              "(a loomcycle limit, gap G17). Add what it needs to its input template.",
          );
        }
      }
      setModel((m) => {
        if (!m) return m;
        const vars = variableNodes(m);
        const binds = bindingNodes(m);
        const data = dataConnection(m, c, vars, binds);
        if (data === "invalid") return m;
        if (data === "data") {
          const w = planDataWire(m, c, vars, binds);
          return w ? applyDataWire(m, w) : m;
        }
        // A drag to or from a channel sets a name; a drag on a data handle is
        // never a transition. Classified against the model being updated, not
        // a render-time copy, so a fast second drag cannot act on stale views.
        const views = channelNodes(m, channels);
        const agents = agentNodes(m);
        const kind = connectionKind(m, views, c, agents);
        if (kind === "invalid") return m;
        if (kind === "wire") {
          const w = planWire(m, views, c, agents);
          return w ? applyWire(m, w) : m;
        }
        // A drag from an agent node is its Starter's transition.
        const from = transitionSource(agents, c.source);
        // A state's outbound labels must be unique, so a second edge from the
        // same source defaults to a distinct pushback rather than a duplicate
        // `success` the validator would immediately refuse.
        const used = new Set(m.edges.filter((e) => e.from === from).map((e) => e.on));
        const on = used.has("success") ? `pushback:${c.target}` : "success";
        if (used.has(on)) return m;
        return {
          ...m,
          edges: [...m.edges, { from, to: c.target!, on, raw: { from, to: c.target!, on } }],
        };
      });
    },
    [editable, channels, model],
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
      setModel((m) => {
        if (!m) return m;
        // A placed channel nothing is wired to leaves the layout. xyflow only
        // offers to delete an unwired one (`deletable`), and removeChannel
        // refuses a wired one anyway.
        let next = m;
        for (const v of channelNodes(m, channels)) if (gone.has(v.id)) next = removeChannel(next, v);
        // The same for a placed Document or Memory nothing reads.
        for (const v of bindingNodes(m)) if (gone.has(v.id)) next = removeBinding(next, v);
        return {
          ...next,
          nodes: next.nodes.filter((n) => !gone.has(n.id)),
          // Drop the transitions that would otherwise dangle.
          edges: next.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
        };
      });
      setSelectedId(null);
    },
    [editable, channels],
  );

  const onPlaceChannel = useCallback(
    (name: string) => {
      if (!editable) return;
      setModel((m) => (m ? placeChannel(m, channelNodes(m, channels), name) : m));
    },
    [editable, channels],
  );

  // Place a Document or Memory node by name, to be wired by drag. Returns why
  // it cannot be placed, for the palette to show.
  const onPlaceBinding = useCallback(
    (kind: "document" | "memory", ref: string) => {
      const why = bindingRefError(kind, ref);
      if (why || !editable) return why;
      setModel((m) => (m ? placeBinding(m, bindingNodes(m), kind, ref).model : m));
      setSelectedId(bindingNodeId({ kind, ref: ref.trim() }));
      return undefined;
    },
    [editable],
  );

  // The channel panel's "grant" action: adds the sides a channel needs to the
  // team ACL. Authority, so it is an explicit click and forks on save.
  const onGrantChannel = useCallback(
    (channel: string, sides: ChannelSide[]) => {
      if (!editable) return;
      setModel((m) => (m ? { ...m, channelsPatch: withGrant(teamChannels(m), channel, sides) } : m));
    },
    [editable],
  );

  // Feedback while dragging: xyflow greys out a target the drop would refuse.
  const isValidConnection = useCallback(
    (c: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }) =>
      !!model &&
      (dataConnection(model, c, variableViews, bindingViews) ?? connectionKind(model, channelViews, c, agentViews)) !== "invalid",
    [model, channelViews, agentViews, variableViews, bindingViews],
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

  const onWalkHooksChange = useCallback((next: JsonObject | undefined) => {
    setModel((m) => (m ? { ...m, walkHooksPatch: { hooks: next } } : m));
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

  // A team's declared variables (`vars`, RFC DV): declare, set a default,
  // remove. Content: each forks on save.
  const declareVar = useCallback(
    (name: string) => editable && setModel((m) => (m ? declareVariable(m, name) : m)),
    [editable],
  );
  const setVarDefault = useCallback(
    (name: string, value: string) => editable && setModel((m) => (m ? setVariableDefault(m, name, value) : m)),
    [editable],
  );
  const undeclareVar = useCallback(
    (name: string) => {
      if (!editable) return;
      setModel((m) => (m ? undeclareVariable(m, name) : m));
    },
    [editable],
  );

  // Placing a node from the palette (C12). Replaces "Add state": the operator
  // picks a ROLE, and which `states[]` kind that compiles to is the wire
  // format's business, not theirs.
  const placeNode = useCallback(
    (entry: PaletteEntry) => {
      if (!editable || !model) return;
      if (entry.variable) {
        // A variable is not a state: a new one is declared in the team's
        // `vars`, with an empty default the Start dialog lets you change.
        const name = nextVariableName(variableViews);
        declareVar(name);
        setSelectedId(variableNodeId(name));
        return;
      }
      const raw = newStateRaw(model, entry);
      if (entry.kind === "input") {
        // The Input node is the walk's ENTRY, wired into the old one — placed
        // loose it was unreachable and a dead end (RFC CZ "The Input node").
        const placed = placeInput(model, raw, [...channelViews, ...agentViews].map((v) => v.position));
        if (placed.existing) setStatus("This team already starts with its Input node.");
        else setModel(placed.model);
        setSelectedId(placed.id);
        return;
      }
      const id = String(raw.state);
      setModel((m) => {
        if (!m) return m;
        // Stagger below the existing nodes rather than stacking every new one
        // at the same point, which made placing three in a row look like one.
        const y = 40 + m.nodes.length * 30;
        return {
          ...m,
          layoutDirty: true,
          nodes: [
            ...m.nodes,
            {
              id,
              kind: entry.kind ?? "",
              opaque: false,
              position: { x: 40, y },
              raw,
            },
          ],
          // The FIRST node placed into an empty graph becomes the entry, or the
          // definition is invalid the moment it is created and the operator has
          // to discover a field that is not on any node.
          entry: m.entry || id,
        };
      });
      // Select it: a freshly placed node is invalid until configured, and the
      // inspector is where that gets fixed.
      setSelectedId(id);
    },
    [editable, model, channelViews, agentViews, variableViews, declareVar],
  );

  const relayout = useCallback(() => {
    if (!editable) return;
    setModel((m) => (m ? withLayout(m, autoLayout(m), true) : m));
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
      savedKey.current = contentKey(model);
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
  const startRun = useCallback(async (form?: FormResult, vars?: Record<string, string>) => {
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
      const started = await dataLayer.runTeamDetached({
        defId: parentDefId.current ?? undefined,
        ...(form ? { input: form.input } : {}),
        ...(vars ? { vars } : {}),
      });
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
      setStartOpen(false);
    } catch (e) {
      if (form) setStartError(`Could not start: ${msg(e)}`);
      else setError(`Could not start the run: ${msg(e)}`);
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

  const abort = abortAvailability(session, !!dataLayer.cancelWalk);

  // The session ends only on the runtime's answer. Ending it locally first
  // would show "aborted" over a walk that is still spending tokens whenever
  // the cancel fails — an older runtime 409s it.
  const abortWalk = useCallback(async () => {
    const runId = session.runId;
    if (!dataLayer.cancelWalk || !runId || !isLive(session)) return;
    setBusy(true);
    setError(undefined);
    try {
      const { stopped } = await dataLayer.cancelWalk(runId, "aborted from the team canvas");
      if (stopped) {
        dispatchSession({ t: "ended", status: "aborted" });
        setStatus(`Aborted ${runId}.`);
      } else {
        // Nothing in flight: it ended on its own before the cancel arrived,
        // and this surface did not see how.
        dispatchSession({ t: "ended", status: "unknown" });
        setStatus(`${runId} had already ended; nothing was stopped.`);
      }
    } catch (e) {
      setError(`Could not stop the walk — it is still running: ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  }, [dataLayer, session]);

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
            // A team with an Input node starts from its form.
            onClick={() => (plan || declaresVars ? openStart() : void startRun())}
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
            <button className="lb-wf-btn" onClick={abortWalk} disabled={busy}>
              Abort
            </button>
          ) : (
            // Shown-and-disabled rather than hidden: "why can I not stop this"
            // is the question an operator will actually have, and the tooltip
            // is the answer.
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

        <label className="lb-wf-toggle" title="Show or hide the transitions between states — the walk's order. Hiding them changes nothing in the definition.">
          <input
            type="checkbox"
            checked={showTransitions}
            onChange={(e) => setShowTransitions(e.target.checked)}
          />
          Transitions
        </label>

        <span className="lb-wf-toolbar__spacer" />
        <span className={`lb-wf-phase lb-wf-phase--${session.phase}`}>{statusLabel(session)}</span>
        {/* The walk's id follows the session, not a one-shot notice: a notice
            set at start said "Running" long after the walk had failed. */}
        {session.runId && (
          <code className="lb-wf-walk-id" data-testid="walk-id">
            {session.runId}
          </code>
        )}
        {errorCount > 0 && (
          <span className="lb-wf-badge lb-wf-badge--error">
            {errorCount} {errorCount === 1 ? "problem" : "problems"}
          </span>
        )}
        {status && <span className="lb-wf-badge lb-wf-badge--ok">{status}</span>}
      </div>

      {error && <div className="lb-wf-error">{error}</div>}

      {startOpen && (plan || declaresVars) && model && (
        <InputDialog
          fields={plan ? inputFields(model.nodes.find((n) => n.id === plan.input)!) : []}
          vars={savedVars}
          listDocuments={dataLayer.listDocuments}
          listChunks={dataLayer.listChunks}
          busy={busy}
          blocked={
            unsaved
              ? "Save a new version first — Start runs the saved version, which is not what is on screen."
              : !canRun
                ? "A walk is already on screen. Go back to Edit to start another."
                : undefined
          }
          error={startError}
          onStart={(form, vars) => void startRun(form, vars)}
          onClose={() => setStartOpen(false)}
        />
      )}

      {composing && entryChannel && dataLayer.publishChannel && (
        <PublishComposer
          channel={entryChannel}
          info={channels?.find((c) => c.name === entryChannel)}
          channelsLoaded={channels !== undefined}
          loadedDefId={parentDefId.current ?? undefined}
          activeDefId={activeDefId}
          disabled={busy}
          onPublish={(payload, scope) => dataLayer.publishChannel!(entryChannel, payload, { scope })}
          onClose={() => setComposing(false)}
        />
      )}

      <div className="lb-wf-body">
        {editable && (
          <Palette
            onPlace={placeNode}
            disabled={!model || busy}
            onPlaceChannel={onPlaceChannel}
            channelNames={[...(model ? localNames(model, "channels").map((n) => `./${n}`) : []), ...(channels?.map((c) => c.name) ?? [])]}
            onPlaceBinding={onPlaceBinding}
          />
        )}

        <div className={`lb-wf-graph${editable ? "" : " is-locked"}`}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            fitView
            // A channel pipeline is one long row (channel, Starter, agent per
            // stage); the default 0.5 floor left fit-view unable to show all
            // of it beside the palette and inspector.
            minZoom={0.2}
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
                if (n.type === "channel") return "is-channelref";
                if (n.type === "binding") return "is-binding";
                if (n.type === "agent") return "is-agentref";
                const d = n.data as unknown as { node?: { kind?: string; opaque?: boolean } };
                if (d?.node?.opaque) return "is-opaque";
                return `is-${d?.node?.kind || "unset"}`;
              }}
            />
          </ReactFlow>
        </div>

        {!readonly && renderRunChat && walk && selected && sideTab === "chat" && rowsForState(walk, selected.id).length > 0 ? (
          <RunChatColumn
            key={selected.id}
            state={selected.id}
            rows={rowsForState(walk, selected.id)}
            renderRunChat={renderRunChat}
            onDetails={() => setSideTab("details")}
          />
        ) : !readonly && (
          <Inspector
            node={selected}
            findings={findings}
            agentNames={agentChoices}
            teamOwn={teamOwn}
            teamOwnEdit={editable ? teamOwnEdit : undefined}
            disabled={busy || !editable}
            onPatch={onPatch}
            onRename={onRename}
            channels={model ? teamChannels(model) : undefined}
            onChannelsChange={onChannelsChange}
            onGrantChannel={editable ? onGrantChannel : undefined}
            walkHooks={model ? walkHooks(model) : undefined}
            onWalkHooksChange={onWalkHooksChange}
            channel={channelViews.find((v) => v.id === selectedId) ?? null}
            binding={bindingViews.find((v) => v.id === selectedId) ?? null}
            variable={variableViews.find((v) => v.id === selectedId) ?? null}
            onDeclareVariable={editable ? declareVar : undefined}
            onSetVariableDefault={editable ? setVarDefault : undefined}
            onUndeclareVariable={editable ? undeclareVar : undefined}
            runs={
              walk && selected ? (
                <>
                  {renderRunChat && rowsForState(walk, selected.id).length > 0 && (
                    <button type="button" className="lb-wf-btn" onClick={() => setSideTab("chat")}>
                      Conversation
                    </button>
                  )}
                  <RunsPanel
                    rows={rowsForState(walk, selected.id)}
                    readRun={dataLayer.readRun}
                    readRunPrompt={dataLayer.readRunPrompt}
                  />
                </>
              ) : undefined
            }
            result={
              selected && result && selected.id === endedAt ? (
                <ResultPanel items={result.items} readChunk={dataLayer.readChunk} onOpenDocument={onOpenDocument} />
              ) : undefined
            }
            form={
              selected && !selected.opaque && (selected.kind === "input" || isInputStarter(selected)) ? (
                <InputFieldsPanel
                  fields={inputFields(selected)}
                  disabled={busy || !editable}
                  // An emptied variable map comes back `undefined`, removing it.
                  onChange={(fs) => onPatch(fieldsPatch(selected, fs))}
                />
              ) : undefined
            }
          />
        )}
      </div>

      {dataLayer.peekChannel && outputs.length > 0 && (
        <OutputPanel channels={outputs} peekChannel={dataLayer.peekChannel} refreshKey={outputRefresh} />
      )}

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
/** A state's place in a running walk, for its node's colour. */
function progressOf(p: WalkProgress | undefined, id: string): "active" | "passed" | undefined {
  return p?.active.has(id) ? "active" : p?.passed.has(id) ? "passed" : undefined;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
