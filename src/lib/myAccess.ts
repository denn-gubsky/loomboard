import type { AuthzAppliedBinding, AuthzDecision, AuthzEvaluationRequest, WhoamiResponse } from "@loomcycle/client";

// The "My access" view's logic, kept pure: what /v1/_me says about how the
// principal is connected, and how to ask and read a "may I…?" question about
// itself (POST /v1/_authz/explain, open to any principal about its own
// subject). The wording follows loomcycle's access simulator
// (web/src/components/access/SimulatorTab.tsx), so the two read alike.

/** One labelled fact about the connection. */
export interface Fact {
  label: string;
  value: string;
}

/** How the principal is connected, one fact per thing /v1/_me told us. A
 *  field the server did not send is left out rather than shown as "—". */
export function connectionFacts(p: WhoamiResponse, signedIn: boolean): Fact[] {
  const out: Fact[] = [
    { label: "Subject", value: p.subject || "—" },
    { label: "Tenant", value: p.tenant_id || "default" },
    { label: "Connected with", value: signedIn ? "Sign in with loomcycle" : p.open_mode ? "No credential (open mode)" : "A token" },
  ];
  const a = p.auth;
  if (a?.gate) out.push({ label: "Sign-in option", value: a.gate });
  if (a?.amr?.length) out.push({ label: "Methods", value: a.amr.join(", ") });
  if (a?.auth_time) out.push({ label: "Signed in", value: when(a.auth_time) });
  if (a?.session_expires_at) {
    out.push({ label: "Session ends", value: `${when(a.session_expires_at)} unless you stay active` });
  }
  if (a?.status === "pending") out.push({ label: "Status", value: "Waiting for an operator's approval" });
  const r = p.restrictions;
  if (r?.agents?.length) out.push({ label: "Limited to agents", value: r.agents.join(", ") });
  if (r?.overrides) {
    out.push({ label: "Run settings you may change", value: r.overrides === "none" ? "none" : r.overrides.join(", ") });
  }
  if (r?.rate) {
    out.push({ label: "Run starts", value: `at most ${r.rate.per_minute} a minute${r.rate.burst ? `, ${r.rate.burst} at once` : ""}` });
  }
  if (r?.retention === "none") out.push({ label: "Run history", value: "not kept for runs this token starts" });
  return out;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** What the access-rule mode means for this principal, in a sentence. */
export function modeNote(mode: string | undefined): string {
  switch (mode) {
    case "enforce":
      return "Access rules decide what you may do; a request no rule allows is refused.";
    case "shadow":
      return "Your token's scopes decide; access rules are checked alongside, and where they would decide differently it is logged.";
    case "compat":
      return "Your token's scopes decide; access rules only add refusals they state.";
    default:
      return "This loomcycle has no access rules.";
  }
}

/** The question for "may I ‹action› ‹type›:‹name›?" about the caller. A blank
 *  name asks about any instance of the type. Null until an action and a type
 *  are given. */
export function selfQuestion(action: string, type: string, name: string): AuthzEvaluationRequest | null {
  const a = action.trim();
  const t = type.trim();
  if (!a || !t) return null;
  return { action: { name: a }, resource: { type: t, id: name.trim() } };
}

/** The rules that made the outcome: the denies of a deny, the allows of an
 *  allow. The server lists every matching rule, so a deny's reasons also carry
 *  the allows it overrode. */
export function decidingReasons(d: AuthzDecision): NonNullable<AuthzDecision["reasons"]> {
  return (d.reasons ?? []).filter((r) => r.effect === d.outcome);
}

/** A list bound to the caller and what it is bound through: `"ops" → group
 *  eng`, `"base" → tenant`. */
export function bindingLine(b: AuthzAppliedBinding): string {
  return `"${b.acl}" → ${b.subject_kind}${b.subject_id ? ` ${b.subject_id}` : ""}`;
}

/** The outcome, in a sentence. */
export function outcomeNote(d: AuthzDecision): string {
  if (d.outcome === "no_match") {
    return d.mode === "enforce"
      ? "No rule answers this; in enforce mode that is a refusal."
      : `No rule answers this; in ${d.mode} mode your token's scopes decide.`;
  }
  if (d.tenant_floor) return "Refused by the tenant floor: the resource is in another tenant.";
  return d.outcome === "allow" ? "A rule allows it and no rule denies it." : "A rule denies it; a deny beats every allow.";
}
