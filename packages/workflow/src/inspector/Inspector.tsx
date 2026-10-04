import { useMemo, type ReactNode } from "react";
import { FoldedFieldList, HookEventsControl, type DefValue } from "@loomcycle/def-fields";
import type { CanvasNode, Json, JsonObject, TeamChannels } from "../lib/model";
import { KNOWN_KINDS, handlerOf } from "../lib/model";
import type { Finding } from "../lib/validate";
import { channelBacklog, type ChannelNodeView } from "../lib/channelNodes";
import type { ChannelSide } from "../lib/channels";
import { MEMORY_VARIANTS, type BindingNodeView } from "../lib/bindings";
import { HANDLER_OMIT_IN_LIST, fieldsForKind, teamHandlerRegistry } from "./registry";

export interface InspectorProps {
  node: CanvasNode | null;
  findings: Finding[];
  agentNames?: string[];
  disabled?: boolean;
  onPatch: (fields: Record<string, Json | undefined>) => void;
  onRename: (id: string) => void;
  /** The team's channel ACL, shown when no state is selected. */
  channels?: TeamChannels;
  onChannelsChange?: (next: TeamChannels) => void;
  /** The walk's own hooks (run_end only), shown when no state is selected. */
  walkHooks?: JsonObject;
  onWalkHooksChange?: (next: JsonObject | undefined) => void;
  /** A selected channel node, shown read-only in place of the team pane. */
  channel?: ChannelNodeView | null;
  /** Grant the sides a channel needs in the team ACL. Absent: no button. */
  onGrantChannel?: (channel: string, sides: ChannelSide[]) => void;
  /** A selected binding node, shown read-only. */
  binding?: BindingNodeView | null;
  /** While a walk is on screen: the selected node's runs (M3b). Rendered
   *  above the fields, because in Run mode they are what the operator came
   *  to see. */
  runs?: ReactNode;
  /** The Input node's form editor (fields, pickers, variables). Rendered
   *  above the raw fields, which still show the schema it writes. */
  form?: ReactNode;
  /** The End node a walk finished at: what it produced, in full. */
  result?: ReactNode;
}

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
  channels,
  onChannelsChange,
  walkHooks,
  onWalkHooksChange,
  channel,
  onGrantChannel,
  binding,
  runs,
  form,
  result,
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

  if (!node && binding) return <BindingPanel view={binding} />;
  if (!node && channel) return <ChannelPanel view={channel} disabled={disabled} onGrant={onGrantChannel} />;

  if (!node) {
    // With nothing selected the inspector shows the TEAM's own configuration
    // rather than an empty pane: the channel ACL and the walk's own hooks,
    // neither of which is a property of any one state.
    return (
      <aside className="lb-wf-inspector lb-wf-inspector--team">
        <p className="lb-wf-inspector__hint">Select a node to edit it.</p>
        {channels && onChannelsChange && (
          <TeamChannelPanel value={channels} disabled={disabled} onChange={onChannelsChange} />
        )}
        {onWalkHooksChange && (
          <section className="lb-wf-team">
            <h3 className="lb-wf-team__title">Walk hooks</h3>
            <p className="lb-wf-team__hint">
              The walk is itself a run, and it only ends, so only <code>run_end</code> fires for it
              &mdash; to report how it ended. Hooks on the runs it starts belong on those nodes.
            </p>
            <HookEventsControl
              value={walkHooks}
              events={["run_end"]}
              disabled={disabled}
              onChange={(next) => onWalkHooksChange(next as JsonObject | undefined)}
            />
          </section>
        )}
      </aside>
    );
  }

  const nodeFindings = findings.filter((f) => f.nodeId === node.id);

  return (
    <aside className="lb-wf-inspector">
      <label className="lb-wf-field">
        <span className="lb-wf-field__label">Node id</span>
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
          {KNOWN_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      {result}
      {runs}
      {form}

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
            // diffing, so a cleared field becomes an explicit `undefined` —
            // which patchHandler takes as "remove this key from the handler".
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

/** The team's channel allowlist.
 *
 *  WHY it is a plain textarea-per-list rather than a picker: the runtime
 *  validates this at create/fork to only NARROW what the authoring principal
 *  already holds, and the canvas cannot know that principal's grants. Offering
 *  a picker would imply an authority check this component is not in a position
 *  to make, and would block authoring a team whose channels do not exist yet.
 *
 *  The warning is not decoration. `channels` is hashed as content, so unlike
 *  dragging a node, touching this forks the definition on save. */
function TeamChannelPanel({
  value,
  disabled,
  onChange,
}: {
  value: TeamChannels;
  disabled?: boolean;
  onChange: (next: TeamChannels) => void;
}) {
  const edit = (key: "publish" | "subscribe") => (text: string) =>
    onChange({
      ...value,
      [key]: text
        .split(/[\n,]/)
        .map((c) => c.trim())
        .filter(Boolean),
    });

  return (
    <section className="lb-wf-team">
      <h3 className="lb-wf-team__title">Team channels</h3>
      <p className="lb-wf-team__hint">
        The workflow&rsquo;s own allowlist. A Starter is the single ACL subject for its source and
        sink, so agents in a wave need no channel grants of their own.
      </p>
      {(["subscribe", "publish"] as const).map((key) => (
        <label key={key} className="lb-wf-field">
          <span className="lb-wf-field__label">
            {key === "subscribe" ? "Subscribe (read)" : "Publish (write)"}
          </span>
          <textarea
            className="lb-wf-input lb-wf-team__list"
            rows={3}
            spellCheck={false}
            disabled={disabled}
            placeholder="one channel per line"
            value={(value[key] ?? []).join("\n")}
            onChange={(e) => edit(key)(e.target.value)}
          />
        </label>
      ))}
      <p className="lb-wf-team__warn">
        Editing the ACL forks the definition — it is authority, and the runtime hashes it as
        content so a change cannot be invisible in the version history.
      </p>
    </section>
  );
}

/** A channel node's details. Read-only: the channel is a ChannelDef that lives
 *  outside the TeamDef (decision C11), so its scope, hold and hooks are edited
 *  where it is declared. What the canvas CAN change is which of its nodes name
 *  it, and the team's ACL — so the panel points at both. */
function ChannelPanel({
  view,
  disabled,
  onGrant,
}: {
  view: ChannelNodeView;
  disabled?: boolean;
  onGrant?: (channel: string, sides: ChannelSide[]) => void;
}) {
  const { info, grants, declared } = view;
  const row = (label: string, value: string) => (
    <div className="lb-wf-field">
      <span className="lb-wf-field__label">{label}</span>
      <span>{value}</span>
    </div>
  );
  const missing = (["publish", "subscribe"] as const).filter((s) => grants[s] === false);
  return (
    <aside className="lb-wf-inspector lb-wf-inspector--channel">
      <h3 className="lb-wf-team__title">
        Channel <code>{view.channel}</code>
      </h3>
      <p className="lb-wf-team__hint">
        Referenced, not owned: this team names it; its declaration lives outside the workflow.
      </p>
      {row("Publishers", view.publishers.join(", ") || "none")}
      {row("Readers", view.readers.join(", ") || "none — results are parked here")}
      {info && row("Scope", info.scope ?? "not declared")}
      {info && row("Stored", channelBacklog(info) ?? "")}
      {info?.hold && row("Hold", "HELD — stored, delivered to nobody until released")}
      {(info?.hooks?.length ?? 0) > 0 &&
        row("Hooks", `${info!.hooks!.join(", ")} — each message is delivered only if they release it`)}
      {declared === false && (
        <div className="lb-wf-finding lb-wf-finding--error">
          Not declared. The runtime refuses an undeclared channel — declare it in operator yaml or
          with ChannelDef.
        </div>
      )}
      {missing.length > 0 && (
        <div className="lb-wf-finding lb-wf-finding--error">
          The team ACL does not grant {missing.join(" or ")} on this channel, so the runtime
          refuses the save.
          {onGrant && (
            <>
              {" "}
              <button
                type="button"
                className="lb-wf-btn"
                disabled={disabled}
                onClick={() => onGrant(view.channel, missing)}
              >
                Grant {missing.join(" + ")} in Team channels
              </button>
              <span className="lb-wf-team__warn">
                {" "}Authority: this changes the definition, and saving forks it. The runtime still
                refuses a grant wider than what you hold.
              </span>
            </>
          )}
        </div>
      )}
      {!view.wired && (
        <p className="lb-wf-team__hint">
          Not wired yet. Drag a Starter&rsquo;s or publish node&rsquo;s top handle into this channel
          to publish to it, or from it to a Starter&rsquo;s top handle to read it. Delete removes it
          from the canvas.
        </p>
      )}
    </aside>
  );
}

/** A binding's details. Read-only: a binding IS a placeholder in a prompt,
 *  so it is added or removed by editing that prompt — the panel names which
 *  fields hold it. */
function BindingPanel({ view }: { view: BindingNodeView }) {
  const row = (label: string, value: string) => (
    <div className="lb-wf-field">
      <span className="lb-wf-field__label">{label}</span>
      <span>{value}</span>
    </div>
  );
  const placeholder = `{{${view.kind}:${view.ref}}}`;
  return (
    <aside className="lb-wf-inspector lb-wf-inspector--binding">
      <h3 className="lb-wf-team__title">
        {view.kind === "document" ? "Document" : "Memory"} <code>{view.ref}</code>
      </h3>
      <p className="lb-wf-team__hint">
        Resolved by the runtime into the prompt of every node that names it — the agent receives
        it and cannot decline to read it.
      </p>
      {row("Placeholder", placeholder)}
      {row("Read by", view.readers.map((r) => `${r.state} (${r.field})`).join(", "))}
      {view.kind === "document" &&
        row(
          "Delivered as",
          view.delivery === "directive"
            ? "a directive naming the tool and path — the agent reads the live document. Add #Heading to inline one section instead."
            : "the content, inlined into the prompt",
        )}
      {view.templated && row("Resolved", "per run — the ref contains ${…}, so what it names is decided when the walk runs")}
      {view.unknownVariant && (
        <div className="lb-wf-finding lb-wf-finding--error">
          Not a memory section this runtime knows, so it renders empty. Known sections:{" "}
          {MEMORY_VARIANTS.join(", ")}.
        </div>
      )}
      <p className="lb-wf-team__hint">To remove it, delete the placeholder from those prompts.</p>
    </aside>
  );
}
