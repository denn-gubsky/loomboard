import type { AgentDefOverlay, LoomcycleClient } from "@loomcycle/client";
import { ASSISTANT_AGENT, CMD_CHANNEL, RESULT_CHANNEL } from "./protocol";
import { CHROME_ASSISTANT_PROMPT } from "./systemPrompt";

// Ensure the browser-assistant AgentDef exists — CREATE-IF-ABSENT, never modify.
// Critically non-destructive: if the agent already exists (or a lookup fails
// ambiguously), we leave it untouched, so a user/operator who configured
// chrome-assistant's model (or forked it) doesn't get clobbered back to a
// model-less default on every connect. We only create when the def is
// definitively absent (404). The default def grants the browser-bridge tools —
// Channel + WebFetch + WebSearch + Memory + Skill — the channel ACL, and
// sql_scopes (rides the [extra] tail; needs LOOMCYCLE_SQLMEM_ENABLED=1).
export async function ensureChromeAssistant(
  client: LoomcycleClient,
): Promise<void> {
  try {
    await client.agentDef({ op: "get", name: ASSISTANT_AGENT });
    return; // exists — never overwrite
  } catch (e) {
    if (!isNotFound(e)) {
      // Ambiguous (scope / network). Do NOT create — assume it may exist, so we
      // don't clobber a user-configured def. The chat surfaces a clear error if
      // the agent is genuinely missing.
      console.warn(
        "[loomboard] chrome-assistant lookup failed; leaving it untouched:",
        e,
      );
      return;
    }
  }

  // Definitively absent → create the default def.
  const overlay: AgentDefOverlay = {
    system_prompt: CHROME_ASSISTANT_PROMPT,
    tools: ["Channel", "WebFetch", "WebSearch", "Memory", "Skill"],
    channels: { publish: [CMD_CHANNEL], subscribe: [RESULT_CHANNEL] },
    sql_scopes: ["user"],
    interruption: { enabled: true },
  };
  await client.agentDef({
    op: "create",
    name: ASSISTANT_AGENT,
    overlay,
    description: "loomboard Chrome side-panel browser assistant.",
  });
}

function isNotFound(e: unknown): boolean {
  return (e as { status?: unknown } | null)?.status === 404;
}
