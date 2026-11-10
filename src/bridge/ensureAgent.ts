import type { AgentDefOverlay, LoomcycleClient } from "@loomcycle/client";
import { ASSISTANT_AGENT } from "./protocol";
import { CHROME_ASSISTANT_PROMPT } from "./systemPrompt";

/** What ensureChromeAssistant found or did. `refused`: a 403 — an access
 *  rule or the token's scopes — on the lookup or the create. `unknown`: it
 *  failed some other way, so nothing is known about the def. */
export type AgentSetup =
  | { kind: "exists" }
  | { kind: "created" }
  | { kind: "refused"; code?: string }
  | { kind: "unknown" };

// Ensure the browser-assistant AgentDef exists — CREATE-IF-ABSENT, never modify.
// Critically non-destructive: if the agent already exists (or a lookup fails
// ambiguously), we leave it untouched, so a user/operator who configured
// chrome-assistant's model (or forked it) doesn't get clobbered back to a
// model-less default on every connect. We only create when the def is
// definitively absent (404). The default def grants the browser client-tools
// (`client__browser_*`, served by this extension's client-tool host) plus
// WebFetch + WebSearch + Memory + Skill, and sql_scopes (rides the [extra] tail;
// needs LOOMCYCLE_SQLMEM_ENABLED=1). NOTE: a chrome-assistant created by an
// older (channel-bridge) extension grants `Channel` instead — an operator must
// re-grant it `client__browser_*` (and may drop `Channel`) for actuation to work.
//
// Never throws: connecting must not depend on it. The outcome tells the panel
// whether to warn that the agent may be missing (agentSetupNotice).
export async function ensureChromeAssistant(client: LoomcycleClient): Promise<AgentSetup> {
  try {
    await client.agentDef({ op: "get", name: ASSISTANT_AGENT });
    return { kind: "exists" }; // never overwrite
  } catch (e) {
    if (!isNotFound(e)) {
      // Ambiguous (scope / network). Do NOT create — assume it may exist, so we
      // don't clobber a user-configured def.
      console.warn("[loomboard] chrome-assistant lookup failed; leaving it untouched:", e);
      return refusal(e);
    }
  }

  // Definitively absent → create the default def.
  const overlay: AgentDefOverlay = {
    system_prompt: CHROME_ASSISTANT_PROMPT,
    tools: ["client__browser_*", "WebFetch", "WebSearch", "Memory", "Skill"],
    sql_scopes: ["user"],
    interruption: { enabled: true },
  };
  try {
    await client.agentDef({
      op: "create",
      name: ASSISTANT_AGENT,
      overlay,
      description: "loomboard Chrome side-panel browser assistant.",
    });
    return { kind: "created" };
  } catch (e) {
    console.warn("[loomboard] could not create chrome-assistant:", e);
    return refusal(e);
  }
}

/** The notice the panel shows for a setup outcome, or null when there is
 *  nothing to say. A refused lookup does not prove the agent is missing (the
 *  operator may have made it), hence "may not be". Pure. */
export function agentSetupNotice(setup: AgentSetup): string | null {
  if (setup.kind !== "refused") return null;
  const who = setup.code === "acl_denied" ? "your access rules don't" : "your sign-in doesn't";
  return (
    `The ${ASSISTANT_AGENT} agent may not be on this loomcycle, and ${who} let you set it up. ` +
    `If the assistant does not answer, ask your operator to create ${ASSISTANT_AGENT} or to let you create agents.`
  );
}

function isNotFound(e: unknown): boolean {
  return (e as { status?: unknown } | null)?.status === 404;
}

// A 403 refuses this principal: an access rule (`acl_denied`) or the token's
// scopes. Anything else (a 5xx, the network) says nothing about it.
function refusal(e: unknown): AgentSetup {
  const err = e as { status?: unknown; code?: unknown } | null;
  if (err?.status !== 403) return { kind: "unknown" };
  return typeof err.code === "string" ? { kind: "refused", code: err.code } : { kind: "refused" };
}
