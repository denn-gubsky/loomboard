import type { AgentDefOverlay, LoomcycleClient } from "@loomcycle/client";
import { ASSISTANT_AGENT, CMD_CHANNEL, RESULT_CHANNEL } from "./protocol";
import { CHROME_ASSISTANT_PROMPT } from "./systemPrompt";

// Ensure the browser-assistant AgentDef exists (idempotent). Mirrors the
// per-conversation fork pattern in src/chat/lib/agentFork.ts. The overlay grants
// the tools the assistant needs (browser bridge over Channel, plus WebFetch /
// WebSearch / Memory-SQL / Skill) and the channel ACL for the two bridge
// channels. `sql_scopes` rides the overlay's forward-compatible [extra] tail and
// requires LOOMCYCLE_SQLMEM_ENABLED=1 on the runtime.
export async function ensureChromeAssistant(
  client: LoomcycleClient,
): Promise<void> {
  const overlay: AgentDefOverlay = {
    system_prompt: CHROME_ASSISTANT_PROMPT,
    tools: ["Channel", "WebFetch", "WebSearch", "Memory", "Skill"],
    channels: { publish: [CMD_CHANNEL], subscribe: [RESULT_CHANNEL] },
    sql_scopes: ["user"],
    interruption: { enabled: true },
  };

  // Create only if missing. If the def already exists we leave its current
  // version in place (re-registering the prompt across versions is a later
  // concern). A create race is tolerated: on failure, confirm existence.
  try {
    await client.agentDef({ op: "get", name: ASSISTANT_AGENT });
    return;
  } catch {
    // Not found (or transient) — attempt to create below.
  }
  try {
    await client.agentDef({
      op: "create",
      name: ASSISTANT_AGENT,
      overlay,
      description: "loomboard Chrome side-panel browser assistant.",
    });
  } catch (e) {
    // A concurrent open may have created it; if it now exists, that's success.
    await client
      .agentDef({ op: "get", name: ASSISTANT_AGENT })
      .catch(() => {
        throw e;
      });
  }
}
