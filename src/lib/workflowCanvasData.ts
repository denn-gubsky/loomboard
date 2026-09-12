import type { LoomcycleClient } from "@loomcycle/client";
import type {
  DetachedRun,
  SavedTeam,
  TeamDefDetail,
  TeamSummary,
  WorkflowDataLayer,
} from "@loomboard/workflow";

// loomboard's binding of @loomboard/workflow's injected data layer to
// @loomcycle/client.
//
// The canvas package deliberately depends on no SDK (loomcycle's own web
// console will bind the same interface to its hand-rolled api.ts), so this
// adapter is where the two meet. It is thin on purpose: anything that looks
// like workflow logic belongs in the package, not here.

/** Resolve a team's ACTIVE version.
 *
 *  The wire has no get-active-by-name: `/v1/_teamdef/names` carries
 *  `active_def_id`, and `op=get` fetches by def_id. Two calls, which is why
 *  the package declares this as its own method rather than making every host
 *  rediscover the sequence. */
async function getActiveTeamDef(client: LoomcycleClient, name: string): Promise<TeamDefDetail> {
  const { names } = await client.listTeams();
  const summary = (names ?? []).find((t) => t.name === name);
  if (!summary) throw new Error(`team ${name} not found`);
  if (!summary.active_def_id) {
    // Every version retired, or a name with no promoted pointer. Saying so
    // beats a confusing "not found" from op=get with an empty def_id.
    throw new Error(`team ${name} has no active version`);
  }
  return (await client.getTeamDef(summary.active_def_id)) as TeamDefDetail;
}

export function workflowDataLayer(client: LoomcycleClient): WorkflowDataLayer {
  return {
    async listTeams(): Promise<TeamSummary[]> {
      // The server encodes "no teams" as a nil slice, so `names` is null
      // rather than [] — normalise it here so the canvas never has to.
      const { names } = await client.listTeams();
      return names ?? [];
    },

    getActiveTeamDef: (name) => getActiveTeamDef(client, name),

    getTeamDef: (defId) => client.getTeamDef(defId) as Promise<TeamDefDetail>,

    createTeam: (name, definition) =>
      client.createTeam(name, definition as Record<string, unknown>) as Promise<SavedTeam>,

    forkTeam: (name, definition) =>
      client.forkTeam(name, definition as Record<string, unknown>) as Promise<SavedTeam>,

    async listAgents(): Promise<string[]> {
      const { entries } = await client.listLibraryAgents();
      return (entries ?? [])
        .map((e) => e.name)
        .filter(Boolean)
        .sort();
    },

    // Always detached (RFC CZ decision C8). A runtime older than loomcycle
    // #1206 REJECTS mode:"detach" rather than running inline — that rejection
    // is how the canvas detects it, so it is deliberately NOT caught here.
    // Swallowing it and falling back to a blocking run would hand the canvas a
    // finished trace with no run id and no way to say why.
    runTeamDetached: async (target): Promise<DetachedRun> =>
      client.runTeam({ ...target, mode: "detach" }),
  };
}
