import type { EffectiveConfigResponse, EffectiveValue } from "@loomcycle/client";

// Turns loomcycle's effective-config report into the two things the settings
// panel can actually show.
//
// WHY THE SOURCE IS THE POINT. `max_iterations: 16` cannot tell a deliberate
// setting from a default nobody chose, and those call for opposite actions —
// one is someone's decision to respect, the other is a blank worth filling. So
// every line names the layer, not just the number.
//
// WHERE IT GOES. @loomcycle/def-fields has no slot for an effective VALUE: an
// unset row renders the bare word "inherited" and the only carriers are
// `unsetMeans` (a title= tooltip) and `placeholder` (ignored by bool, enum, kv
// and object controls). The `hint` paragraph, though, is rendered for every
// field in both states — so that is where this goes. A tooltip nobody hovers
// is not a display.
//
// Pure → unit-tested.

/** How each layer reads to someone looking at the panel. */
const SOURCE_LABEL: Record<string, string> = {
  run: "set for this chat",
  definition: "from the agent",
  user_tier: "from your tier",
  operator: "operator setting",
  resolved: "resolved at run time",
  default: "runtime default",
};

/** Render a value compactly enough to sit at the end of a sentence. Objects are
 *  summarised by their keys rather than dumped: `sampling` and `compaction` are
 *  nested records, and a JSON blob in a hint is noise. */
export function formatValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    return keys.length ? keys.join(", ") : null;
  }
  return null;
}

/** The clause appended to a field's hint, or null when there is nothing honest
 *  to say.
 *
 *  A `resolved` field with no value is reported rather than hidden — the runtime
 *  settles it somewhere the report cannot see, and saying so beats implying the
 *  field is unset. */
export function describeEffective(e: EffectiveValue | undefined): string | null {
  if (!e) return null;
  const label = SOURCE_LABEL[e.source] ?? e.source;
  const shown = formatValue(e.value);
  if (shown === null) {
    return e.source === "resolved" ? "In force: decided at run time." : null;
  }
  return `In force: ${shown} (${label}).`;
}

/** The value to offer as a control's placeholder — only for a field the run does
 *  NOT override, since an overridden one already shows its value in the control.
 *  Returns null for anything a text box cannot sensibly preview. */
export function placeholderFor(e: EffectiveValue | undefined): string | null {
  if (!e || e.source === "run") return null;
  if (typeof e.value !== "string" && typeof e.value !== "number") return null;
  return formatValue(e.value);
}

/** Index the report by wire name. Returns an empty map for a missing report so
 *  callers need no null branch — a chat with no run yet is the normal case, not
 *  an error. */
export function effectiveFields(
  report: EffectiveConfigResponse | null,
): Record<string, EffectiveValue> {
  return report?.fields ?? {};
}

/** A setting this run carries that CANNOT take effect — loomcycle's `inert`
 *  array on the effective-config report (RFC B §B6).
 *
 *  Derived from the SDK rather than re-declared: client 1.86.0 types `inert`
 *  on EffectiveConfigResponse, so the shape now has one owner. (Indexed access
 *  because the package's index.d.ts re-export is an enumerated list that does
 *  not yet include `InertContextSetting` itself.)
 *
 *  Shaped by the runtime, relayed VERBATIM. The reason names the other setting
 *  that disables this one, and `fix` names the knob that does work; rewriting
 *  either here would put us back where `describeDistillDeclined` was, restating
 *  a server that knows more than we do. */
export type InertSetting = EffectiveConfigResponse["inert"][number];

export function inertSettings(report: EffectiveConfigResponse | null): InertSetting[] {
  const raw: unknown = report?.inert;
  if (!Array.isArray(raw)) return [];
  const out: InertSetting[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    // Both are required for the advisory to say anything useful; a row missing
    // either is a runtime we do not understand, so skip it rather than render
    // "undefined cannot take effect".
    if (typeof o.setting !== "string" || typeof o.reason !== "string") continue;
    out.push({
      setting: o.setting,
      reason: o.reason,
      ...(typeof o.fix === "string" && o.fix ? { fix: o.fix } : {}),
    });
  }
  return out;
}
