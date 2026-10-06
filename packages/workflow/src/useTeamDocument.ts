import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { aclFindings } from "./lib/channels";
import { bindingFindings } from "./lib/bindings";
import { forkOverlay, forkWarnings } from "./lib/fork";
import { startFindings } from "./lib/inputForm";
import { autoLayout, needsAutoLayout, withLayout } from "./lib/layout";
import { localBodyFindings } from "./lib/localEdit";
import { contentKey, fromDefinition, toDefinition, type CanvasModel, type JsonObject } from "./lib/model";
import { validateModel, type Finding } from "./lib/validate";
import { variableFindings, variableNodes } from "./lib/variables";
import type { SavedTeam, WorkflowDataLayer } from "./types";

// The team being edited, as one document (RFC DX): what was loaded, what the
// operator has changed, what is wrong with it, and saving it.
//
// The canvas and (from RFC DX phase 3) the JSON view are views over this. It
// owns nothing visual: no selection, no layout measurement, no walk.
//
// Saving is a FORK of the version that was loaded. Two guards decide what a
// save sends:
//   - the stale-parent check (RFC CZ decision 6): a save whose parent is no
//     longer the team's active version is refused rather than silently
//     overwriting whoever moved it;
//   - forkOverlay (lib/fork.ts): a section the draft dropped is cleared
//     against that active version — the one the fork merges over.

export type SaveResult = { ok: true; saved: SavedTeam } | { ok: false; error: string };

export interface TeamDocument {
  /** The draft as the canvas holds it; null until loaded. */
  model: CanvasModel | null;
  setModel: Dispatch<SetStateAction<CanvasModel | null>>;
  /** The loaded team's name, once loaded. */
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
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useTeamDocument(
  dataLayer: WorkflowDataLayer,
  target: { teamName?: string; defId?: string },
  /** Called after each load, e.g. to clear a selection that no longer applies. */
  onLoaded?: () => void,
): TeamDocument {
  const [model, setModel] = useState<CanvasModel | null>(null);
  const [activeDefId, setActiveDefId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  // Refs, not state: a save updates them and then re-renders through
  // setModel, and a click handler must read the value as of the click.
  const parentDefId = useRef<string | null>(null);
  const name = useRef<string | null>(null);
  // The CONTENT last loaded or saved (lib/model contentKey). Run starts that
  // saved version, so any difference means Start would not run what is shown.
  const savedKey = useRef<string>("");
  // The definition last loaded or saved — for what a save cannot do to it
  // (forkWarnings).
  const savedDef = useRef<JsonObject>({});
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const { teamName, defId } = target;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(undefined);
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
        name.current = detail.name;
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
        savedDef.current = toDefinition(next);
        setModel(next);
        onLoadedRef.current?.();
      } catch (e) {
        if (!cancelled) setLoadError(`Failed to load: ${msg(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataLayer, teamName, defId]);

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
            ...forkWarnings(savedDef.current, toDefinition(model)),
          ]
        : [],
    [model],
  );

  const unsaved = useMemo(() => !!model && contentKey(model) !== savedKey.current, [model]);

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!model) return { ok: false, error: "No team loaded." };
    const team = name.current;
    if (!team) return { ok: false, error: "No team loaded." };
    try {
      // Stale-parent check. Two operators editing one team both fork from the
      // same parent, and without this the second silently wins.
      const current = await dataLayer.getActiveTeamDef(team);
      if (parentDefId.current && current.def_id !== parentDefId.current) {
        return {
          ok: false,
          error:
            `This team moved on while you were editing (active version is now ${current.def_id}). ` +
            `Reload to pick up the change — saving would discard it.`,
        };
      }
      // The fork merges over the ACTIVE version, so that is what a dropped
      // section is cleared against — not what was loaded, which after one
      // save in this session is no longer the parent (lib/fork.ts).
      const d = current.definition;
      const parent = typeof d === "object" && d !== null && !Array.isArray(d) ? (d as JsonObject) : {};
      const saved = await dataLayer.forkTeam(team, forkOverlay(parent, toDefinition(model)));
      parentDefId.current = saved.def_id;
      savedKey.current = contentKey(model);
      savedDef.current = toDefinition(model);
      // The saved graph IS the new baseline, so a subsequent save is not a
      // no-op fork of a stale parent.
      setModel((m) => (m ? { ...m, layoutDirty: false } : m));
      return { ok: true, saved };
    } catch (e) {
      return { ok: false, error: `Save failed: ${msg(e)}` };
    }
  }, [dataLayer, model]);

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
  };
}
