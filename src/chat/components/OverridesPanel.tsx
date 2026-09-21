import { useMemo } from "react";
import { FoldedFieldList, type DefValue } from "@loomcycle/def-fields";
import type { EffectiveValue, LibraryAgentDefinition } from "@loomcycle/client";
import type { ConversationOverrides } from "../types";
import { THIS_CHAT, buildOverrideRegistry } from "../lib/overrideRegistry";
import type { InertSetting } from "../lib/effective";

// The chat's per-run overrides editor.
//
// It renders @loomcycle/def-fields' FoldedFieldList — the same editor the
// loomcycle Web UI uses for an AgentDef — rather than a bespoke form. That
// package is natively an OVERLAY editor: an unset field shows what it inherits,
// a set one offers "clear", and clearing DELETES the key instead of writing an
// empty value. That unset-vs-zero distinction is the same one the run wire
// depends on, so the two agree by construction rather than by convention.
//
// Fully controlled, and it performs no writes of its own: the host owns the
// conversation record.

export default function OverridesPanel({
  config,
  baseDef,
  effective,
  inert,
  legacyFork,
  disabled,
  onChange,
}: {
  config: ConversationOverrides;
  /** The base agent's own definition, when the Library can be read — lets an
   *  unset field name the value it inherits. */
  baseDef?: LibraryAgentDefinition;
  /** What the live run will actually use, per field, with the layer that decided
   *  it. Empty for a chat with no run yet — the panel then speaks only for what
   *  the agent's definition declares. */
  effective?: Readonly<Record<string, EffectiveValue>>;
  /** Settings this run carries that cannot take effect (loomcycle's `inert`).
   *  Relayed verbatim — see lib/effective. */
  inert?: readonly InertSetting[];
  /** Set when this conversation predates per-run overrides and still runs on a
   *  forked AgentDef. */
  legacyFork?: string;
  disabled?: boolean;
  onChange: (next: ConversationOverrides) => void;
}) {
  const registry = useMemo(
    () => buildOverrideRegistry(baseDef, effective),
    [baseDef, effective],
  );

  return (
    <div className="config-panel">
      {legacyFork && (
        // Not a disabled state: the overrides DO apply to any future run this
        // chat starts fresh. What they cannot reach is the session already bound
        // to the forked def server-side.
        <p className="config-legacy-note">
          This chat runs on a private agent copy (<code>{legacyFork}</code>) made by an
          older version. Per-run overrides cannot reach it — start a new chat to use
          them.
        </p>
      )}
      {inert && inert.length > 0 && (
        // The runtime is the only party that can know these: `auto` resolves to
        // a concrete mode from the provider and whether the run is interactive,
        // and only then is it decidable that a threshold below is dead. Shown
        // ABOVE the fields because it is about fields in the list below — an
        // operator who reads it after setting the dead knob has read it late.
        //
        // `reason` and `fix` are rendered VERBATIM. Restating a server that
        // knows more than we do is how the declined-distillation notice ended
        // up printing its own clause twice.
        <div className="config-inert" role="note">
          <p className="config-inert__head">
            {inert.length === 1
              ? "One setting on this run cannot take effect:"
              : `${inert.length} settings on this run cannot take effect:`}
          </p>
          <ul className="config-inert__list">
            {inert.map((i) => (
              <li key={i.setting}>
                <code>{i.setting}</code> — {i.reason}
                {i.fix && (
                  <>
                    {" "}
                    Use <code>{i.fix}</code> instead.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FoldedFieldList
        registry={registry}
        value={config as DefValue}
        // def-fields hands back the WHOLE overlay; the conversation record wants
        // one too, so it is passed straight through. (The workflow inspector
        // diffs this into a patch because its host is patch-shaped; ours is not.)
        onChange={(next) => onChange(next as ConversationOverrides)}
        disabled={disabled}
        defaultOpenGroups={[THIS_CHAT]}
      />
    </div>
  );
}
