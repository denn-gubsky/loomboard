import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { aclFindings } from "./lib/channels";
import { UNNAMED_TEAM } from "./lib/check";
import { bindingFindings } from "./lib/bindings";
import { forkOverlay } from "./lib/fork";
import { startFindings } from "./lib/inputForm";
import { viewDefinition } from "./lib/jsonDraft";
import { autoLayout, needsAutoLayout, withLayout } from "./lib/layout";
import { localBodyFindings } from "./lib/localEdit";
import { contentKey, fromDefinition, toDefinition, type CanvasModel, type JsonObject } from "./lib/model";
import { teamNameError } from "./lib/newTeam";
import { validateModel, type Finding } from "./lib/validate";
import { variableFindings, variableNodes } from "./lib/variables";
import type { SavedTeam, TeamCheck, WorkflowDataLayer } from "./types";

// The team being edited, as one document (RFC DX): what was loaded, what the
// operator has changed, what is wrong with it, and saving it.
//
// The canvas and (from RFC DX phase 3) the JSON view are views over this. It
// owns nothing visual: no selection, no layout measurement, no walk.
//
// Saving is a FORK of the version that was loaded. Two guards decide what a
// save sends:
//   - the stale-parent check (RFC CZ decision 6): a save is refused when the
//     team's ACTIVE version is no longer the one this document last saw,
//     rather than silently overwriting whoever moved it. A save here does not
//     move it: loomcycle keeps saving a version and putting it in force
//     apart, so the active version stays where it was unless the host
//     promotes what it saves;
//   - forkOverlay (lib/fork.ts): a section the draft dropped is cleared
//     against that active version — the one the fork merges over.
//
// A document can also start from a TEMPLATE instead of a stored team (RFC DX
// phase 4). It has no name and no parent until `saveAs` creates it.

export type SaveResult = { ok: true; saved: SavedTeam } | { ok: false; error: string };
export type CheckResult = { ok: true; check: TeamCheck } | { ok: false; error: string };

export interface TeamDocument {
  /** The draft as the canvas holds it; null until loaded. */
  model: CanvasModel | null;
  setModel: Dispatch<SetStateAction<CanvasModel | null>>;
  /** The team's name: once loaded, or once a new team is first saved. */
  name: string | null;
  /** The version the draft forks from: the one loaded, then each one saved. */
  parentDefId: string | null;
  /** The team's PROMOTED version, when the host can list teams. */
  activeDefId?: string;
  /** Why the team could not be loaded. */
  loadError?: string;
  /** Everything wrong with the draft that the canvas can know. */
  findings: Finding[];
  /** The draft differs from the version last loaded or saved. */
  unsaved: boolean;
  save(): Promise<SaveResult>;
  /** Create a NEW team from the draft. The document is then that team. */
  saveAs(name: string): Promise<SaveResult>;
  /** Ask the runtime what a save of the draft would meet, saving nothing.
   *  It is sent exactly what `save` would send. */
  check(): Promise<CheckResult>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useTeamDocument(
  dataLayer: WorkflowDataLayer,
  /** A stored team, or — with neither name nor id — the definition a new
   *  team starts from. `template` must be a stable reference. */
  target: { teamName?: string; defId?: string; template?: unknown },
  /** Called after each load, e.g. to clear a selection that no longer applies. */
  onLoaded?: () => void,
): TeamDocument {
  const [model, setModel] = useState<CanvasModel | null>(null);
  const [activeDefId, setActiveDefId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  // Refs, not state: a save updates them and then re-renders through
  // setModel, and a click handler must read the value as of the click.
  const parentDefId = useRef<string | null>(null);
  // The team's ACTIVE version as this document last saw it — what a fork
  // merges over, and what "someone else moved the team" is judged against.
  // Not `parentDefId`: after a save that is the version just saved, which the
  // runtime does not make active.
  const activeSeen = useRef<string | null>(null);
  const name = useRef<string | null>(null);
  // The CONTENT last loaded or saved (lib/model contentKey). Run starts that
  // saved version, so any difference means Start would not run what is shown.
  const savedKey = useRef<string>("");
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const { teamName, defId, template } = target;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(undefined);
      try {
        if (!defId && !teamName && template !== undefined) {
          let next = fromDefinition(template);
          if (needsAutoLayout(next)) next = withLayout(next, autoLayout(next), false);
          parentDefId.current = null;
          activeSeen.current = null;
          name.current = null;
          // Nothing is saved yet, so every draft of it is unsaved.
          savedKey.current = "";
          setActiveDefId(undefined);
          setModel(next);
          onLoadedRef.current?.();
          return;
        }
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
        // Opened by name, this IS the active version. Opened by id it may not
        // be; the listing below says which one is.
        activeSeen.current = defId ? null : detail.def_id;
        name.current = detail.name;
        // The promoted pointer, for C7's "a publish runs the PROMOTED version"
        // warning. Best-effort: a host without listTeams simply loses the
        // warning rather than the composer.
        dataLayer
          .listTeams()
          .then((list) => {
            if (cancelled) return;
            const active = list.find((t) => t.name === detail.name)?.active_def_id;
            setActiveDefId(active);
            activeSeen.current ??= active ?? null;
          })
          .catch(() => undefined);
        savedKey.current = contentKey(next);
        setModel(next);
        onLoadedRef.current?.();
      } catch (e) {
        if (!cancelled) setLoadError(`Failed to load: ${msg(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataLayer, teamName, defId, template]);

  // The graph's own rules PLUS the team ACL and the authoring rules. They come
  // from different places on the runtime — validateModel mirrors
  // teamgraph.Validate, the rest the TeamDef tool's create/fork preflight —
  // but all refuse a save, so the operator sees one list.
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

  const unsaved = useMemo(() => !!model && contentKey(model) !== savedKey.current, [model]);

  // What a save of the draft sends, and the version it forks. One place, so
  // `check` asks the runtime about exactly what `save` would send.
  const forkPlan = useCallback(
    async (team: string, draft: CanvasModel): Promise<{ overlay: JsonObject; parentDefId: string } | { error: string }> => {
      // Stale-parent check. Two operators editing one team both fork from the
      // same parent, and without this the second silently wins.
      const current = await dataLayer.getActiveTeamDef(team);
      // Moved by someone else: neither the version last seen active, nor this
      // document's own last save (a host may promote what it saves).
      if (activeSeen.current && current.def_id !== activeSeen.current && current.def_id !== parentDefId.current) {
        return {
          error:
            `This team moved on while you were editing (active version is now ${current.def_id}). ` +
            `Reload to pick up the change — saving would discard it.`,
        };
      }
      // The fork merges over the ACTIVE version, so that is what a dropped
      // section is cleared against — not what was loaded, which after one
      // save in this session is no longer the parent (lib/fork.ts).
      activeSeen.current = current.def_id;
      const d = current.definition;
      const parent = typeof d === "object" && d !== null && !Array.isArray(d) ? (d as JsonObject) : {};
      return { overlay: forkOverlay(parent, toDefinition(draft)), parentDefId: current.def_id };
    },
    [dataLayer],
  );

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!model) return { ok: false, error: "No team loaded." };
    const team = name.current;
    if (!team) return { ok: false, error: "No team loaded." };
    try {
      const plan = await forkPlan(team, model);
      if ("error" in plan) return { ok: false, error: plan.error };
      const saved = await dataLayer.forkTeam(team, plan.overlay);
      parentDefId.current = saved.def_id;
      savedKey.current = contentKey(model);
      // The saved graph IS the new baseline, so a subsequent save is not a
      // no-op fork of a stale parent.
      setModel((m) => (m ? { ...m, layoutDirty: false } : m));
      return { ok: true, saved };
    } catch (e) {
      return { ok: false, error: `Save failed: ${msg(e)}` };
    }
  }, [dataLayer, model, forkPlan]);

  const saveAs = useCallback(
    async (newName: string): Promise<SaveResult> => {
      if (!model) return { ok: false, error: "No team loaded." };
      try {
        // The runtime does not refuse a create under a name it has: it mints
        // that team's next version and promotes it. So the name is checked
        // here, against the teams as they are now.
        const taken = (await dataLayer.listTeams()).map((t) => t.name);
        const why = teamNameError(newName, taken);
        if (why) return { ok: false, error: `Cannot save as ${JSON.stringify(newName)}: ${why}.` };
        // The layout always goes with a new team: there is no parent to keep
        // one from.
        const saved = await dataLayer.createTeam(newName, viewDefinition(model));
        parentDefId.current = saved.def_id;
        // A create promotes what it makes.
        activeSeen.current = saved.def_id;
        name.current = saved.name;
        savedKey.current = contentKey(model);
        // A create promotes what it makes.
        setActiveDefId(saved.def_id);
        setModel((m) => (m ? { ...m, layoutDirty: false } : m));
        return { ok: true, saved };
      } catch (e) {
        return { ok: false, error: `Save failed: ${msg(e)}` };
      }
    },
    [dataLayer, model],
  );

  const check = useCallback(async (): Promise<CheckResult> => {
    if (!model) return { ok: false, error: "No team loaded." };
    if (!dataLayer.verifyTeam) return { ok: false, error: "This host cannot check a team with the runtime." };
    try {
      const team = name.current;
      if (!team) {
        // Not stored yet: checked as the create its first save will be.
        return { ok: true, check: await dataLayer.verifyTeam(UNNAMED_TEAM, { overlay: viewDefinition(model), as: "create" }) };
      }
      const plan = await forkPlan(team, model);
      if ("error" in plan) return { ok: false, error: plan.error };
      return {
        ok: true,
        check: await dataLayer.verifyTeam(team, { overlay: plan.overlay, as: "fork", parentDefId: plan.parentDefId }),
      };
    } catch (e) {
      return { ok: false, error: `Check failed: ${msg(e)}` };
    }
  }, [dataLayer, model, forkPlan]);

  return {
    model,
    setModel,
    name: name.current,
    parentDefId: parentDefId.current,
    activeDefId,
    loadError,
    findings,
    unsaved,
    save,
    saveAs,
    check,
  };
}
