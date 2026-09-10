import { useMemo } from "react";
import { FoldedFieldList, type DefValue } from "@loomcycle/def-fields";
import type { CanvasNode, Json } from "../lib/model";
import { handlerOf } from "../lib/model";
import type { Finding } from "../lib/validate";
import { HANDLER_OMIT_IN_LIST, fieldsForKind, teamHandlerRegistry } from "./registry";

export interface InspectorProps {
  node: CanvasNode | null;
  findings: Finding[];
  agentNames?: string[];
  disabled?: boolean;
  onPatch: (fields: Record<string, Json | undefined>) => void;
  onRename: (id: string) => void;
}

const KINDS = ["agent", "parallel", "consolidator", "terminal"] as const;

/** The node inspector: the state id and kind rendered by hand, everything else
 *  by def-fields.
 *
 *  WHY the id and kind sit outside the folded list: both change the SHAPE of
 *  the form under them (a kind switch changes which fields are meaningful; the
 *  id is the node's identity, not a parameter), so they belong above the fold
 *  where they are always visible. `omitKeys` is def-fields' contract for
 *  exactly this — the registry stays the complete description of the
 *  primitive, and the host says what it has already covered. */
export function Inspector({
  node,
  findings,
  agentNames,
  disabled,
  onPatch,
  onRename,
}: InspectorProps) {
  const value = useMemo<DefValue>(() => {
    if (!node) return {};
    // Only the fields meaningful for THIS kind. def-fields has no conditional
    // -field concept, so filtering here is what stops `agents` appearing on a
    // terminal state.
    const allowed = new Set(fieldsForKind(node.kind));
    const h = handlerOf(node);
    const out: DefValue = {};
    for (const [k, v] of Object.entries(h)) if (allowed.has(k)) out[k] = v;
    return out;
  }, [node]);

  const omitKeys = useMemo(() => {
    if (!node) return HANDLER_OMIT_IN_LIST;
    const allowed = new Set(fieldsForKind(node.kind));
    const hidden = teamHandlerRegistry.fields
      .map((f) => f.key)
      .filter((k) => !allowed.has(k));
    return [...HANDLER_OMIT_IN_LIST, ...hidden];
  }, [node]);

  if (!node) {
    return (
      <aside className="lb-wf-inspector lb-wf-inspector--empty">
        <p>Select a state to edit it.</p>
      </aside>
    );
  }

  const nodeFindings = findings.filter((f) => f.nodeId === node.id);

  return (
    <aside className="lb-wf-inspector">
      <label className="lb-wf-field">
        <span className="lb-wf-field__label">State id</span>
        <input
          className="lb-wf-input"
          value={node.id}
          disabled={disabled}
          onChange={(e) => onRename(e.target.value)}
          spellCheck={false}
        />
      </label>

      <label className="lb-wf-field">
        <span className="lb-wf-field__label">Kind</span>
        <select
          className="lb-wf-input"
          value={node.opaque ? "" : node.kind}
          disabled={disabled || node.opaque}
          onChange={(e) => onPatch({ kind: e.target.value })}
        >
          {node.opaque && <option value="">{node.kind || "unknown"}</option>}
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      {node.opaque ? (
        // An opaque node is deliberately NOT editable field-by-field: this
        // build does not know which fields the kind requires, so an editor
        // would invite an operator to produce something the runtime refuses.
        // It stays byte-identical on save instead.
        <p className="lb-wf-inspector__opaque">
          <code>{node.kind}</code> is not known to this canvas version. Its configuration is shown
          read-only and written back unchanged.
          <pre className="lb-wf-json">{JSON.stringify(handlerOf(node), null, 2)}</pre>
        </p>
      ) : (
        <FoldedFieldList
          registry={teamHandlerRegistry}
          value={value}
          onChange={(next) => {
            // def-fields hands back the whole overlay; translate to a patch by
            // diffing, so a cleared field becomes an explicit `undefined` and
            // reverts to the raw value rather than shadowing it.
            const patch: Record<string, Json | undefined> = {};
            for (const k of Object.keys(value)) if (!(k in next)) patch[k] = undefined;
            for (const [k, v] of Object.entries(next)) {
              if (value[k] !== v) patch[k] = v as Json;
            }
            if (Object.keys(patch).length) onPatch(patch);
          }}
          disabled={disabled}
          hideToolbar
          omitKeys={omitKeys}
        />
      )}

      {agentNames && agentNames.length > 0 && (
        // A plain datalist rather than a combobox: the field is free text
        // because a team may legitimately name an agent that does not exist
        // yet, and forcing a pick would block authoring a graph before its
        // agents are created.
        <datalist id="lb-wf-agents">
          {agentNames.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      )}

      {nodeFindings.length > 0 && (
        <div className="lb-wf-inspector__findings">
          {nodeFindings.map((f, i) => (
            <div key={i} className={`lb-wf-finding lb-wf-finding--${f.level}`}>
              {f.message}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
