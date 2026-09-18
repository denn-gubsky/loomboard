import type { LoomcycleClient } from "@loomcycle/client";

// What remains of the agent-fork mechanism, kept only for conversations created
// before per-run overrides.
//
// That build gave a chat with custom settings its OWN AgentDef —
// `${baseAgent}__lb-<uuid8>` — because provider/model/tier/effort could then
// only be set on a definition. Nothing mints one any more (RFC DC sends them
// with the run instead), but records that already carry a `forkDefName` still
// run on theirs: the def is bound to the session server-side and cannot be
// retuned, so the name has to survive for the chat to keep working and for the
// orphaned def to stay traceable.
//
// Deleting one is only safe for a chat that never sent, which is the single
// call site left.

/** Best-effort cleanup of a legacy private def when an UNSENT draft is deleted.
 *  Failures are swallowed — a leftover def is harmless, and the principal may
 *  not even hold the scope to remove it. */
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
