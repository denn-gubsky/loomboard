import type { LibraryAgentDefinition, LoomcycleClient } from "@loomcycle/client";
import {
  configIsCustom,
  type ChatConversation as Conversation,
} from "../types";

// Resolve the agent name a conversation should run against.
//
// With no custom config we run the base library agent directly — no def is
// created (the common, side-effect-free path). When the chat overrides
// provider/model/tier/effort we need a private AgentDef, because those knobs
// can only be set on a def, never per-run.
//
// We create a UNIQUELY-NAMED derived def rather than `op:"fork"` the base: fork
// mints a new version under the SAME name and auto-promotes it, which would
// change the shared agent for everyone. A new name keeps the override isolated
// to this conversation. We copy what the library reports for the base
// (system_prompt / allowed_tools / skills); agents whose prompt lives only in a
// file may need the operator to set a prompt — surfaced as a normal run error.
export async function resolveConversationAgent(
  client: LoomcycleClient,
  convo: Conversation,
  baseDef: LibraryAgentDefinition | undefined,
  onChange: (patch: Partial<Conversation>) => void,
): Promise<string> {
  if (!configIsCustom(convo.config)) return convo.baseAgent;
  if (convo.forkDefName) return convo.forkDefName;

  const name = `${convo.baseAgent}__lb-${crypto.randomUUID().slice(0, 8)}`;
  const overlay: Record<string, unknown> = {
    // Enabling the Interruption tool here is what makes the questions feature
    // available on a custom-config chat.
    interruption: { enabled: true },
  };
  if (baseDef?.system_prompt) overlay.system_prompt = baseDef.system_prompt;
  if (baseDef?.allowed_tools) overlay.allowed_tools = baseDef.allowed_tools;
  if (baseDef?.skills) overlay.skills = baseDef.skills;
  if (convo.config.provider) overlay.provider = convo.config.provider;
  if (convo.config.model) overlay.model = convo.config.model;
  if (convo.config.tier) overlay.tier = convo.config.tier;
  if (convo.config.effort) overlay.effort = convo.config.effort;

  await client.agentDef({
    op: "create",
    name,
    overlay,
    description: `loomboard per-conversation override of ${convo.baseAgent}`,
  });
  onChange({ forkDefName: name });
  return name;
}

/** Best-effort cleanup of a conversation's private def when the chat is
 *  deleted. Failures are swallowed — a leftover def is harmless. */
export async function deleteConversationAgent(
  client: LoomcycleClient,
  forkDefName: string,
): Promise<void> {
  try {
    await client.agentDef({ op: "delete", name: forkDefName });
  } catch {
    // ignore — the def may already be gone, or the principal may lack scope.
  }
}
