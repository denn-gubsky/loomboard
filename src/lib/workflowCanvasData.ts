import type { LoomcycleClient } from "@loomcycle/client";
import type {
  ChannelInfo,
  DetachedRun,
  SavedTeam,
  TeamDefDetail,
  TeamSummary,
  WorkflowDataLayer,
} from "@loomboard/workflow";
import { getChunk, queryChunks, queryDocuments } from "./workflowApi";
import { hookNamesOf } from "@loomboard/workflow";
import { runLineFolder } from "./runLines";
import type { PreviewLine } from "./tilePreview";

/** How often a run's lines may redraw its node at most. */
const LINES_COALESCE_MS = 250;
import { watchWalk } from "./walkWatch";

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
  // Resolved once per adapter, and only when a user-scoped publish needs it.
  // `subject` IS the user id: loomcycle's own self-access check is
  // `pathUserID == p.Subject`, and a session's UserID is compared to it the
  // same way — so this is the id the walk will read that channel at.
  let userId: string | undefined;
  const selfUserId = async () => {
    if (userId === undefined) userId = (await client.whoami()).subject;
    return userId;
  };

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

    // Hydrate from listWalkRuns, then stream the walk's transitions — under
    // the caller's own user, which is where a walk's runs are filed since
    // loomcycle 1.101 (gap G9; before it, every walk ran as `http-admin`).
    watchWalk: (walkRunId, onRows, onError) => watchWalk(client, selfUserId, walkRunId, onRows, onError),

    // A member run's last few lines for its node (Run mode). The stream
    // replays the run from its start, then tails it until it ends; updates
    // are coalesced, since a replay — and a model streaming text — arrive in
    // bursts that would otherwise redraw the canvas per token.
    watchRunLines(runId, onLines, onError) {
      const ac = new AbortController();
      const fold = runLineFolder();
      let pending: PreviewLine[] | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        if (pending) onLines(pending);
        pending = undefined;
      };
      (async () => {
        for await (const ev of client.streamRunByID(runId, { signal: ac.signal })) {
          const lines = fold.push(ev);
          if (!lines) continue;
          pending = lines;
          timer ??= setTimeout(flush, LINES_COALESCE_MS);
        }
        if (timer) clearTimeout(timer);
        flush();
      })().catch((e) => {
        if (!ac.signal.aborted) onError?.(e);
      });
      return () => {
        ac.abort();
        if (timer) clearTimeout(timer);
      };
    },

    async readRun(runId) {
      const a = await client.getRun(runId);
      return {
        runId: a.run_id,
        status: a.status,
        finalText: a.result?.final_text,
        structured: a.result?.structured,
        terminal: a.result?.terminal,
        error: a.error ?? undefined,
        stopReason: a.stop_reason ?? undefined,
        startedAt: a.started_at,
        completedAt: a.completed_at ?? undefined,
        model: a.usage?.model,
        inputTokens: a.usage?.input_tokens,
        outputTokens: a.usage?.output_tokens,
      };
    },

    // A result that names a chunk: the team's own documents first (user
    // scope), then the tenant's. The scope found goes back with the chunk so
    // "Open in Documents" opens the same store.
    async readChunk(id) {
      for (const scope of ["user", "tenant"] as const) {
        try {
          const c = await getChunk(client, scope, id);
          return { id: c.id, title: c.title, body: c.body ?? "", documentId: c.document_id, scope };
        } catch (e) {
          if (scope === "tenant") throw e;
        }
      }
      throw new Error("unreachable");
    },

    async readRunPrompt(runId) {
      const p = await client.getRunPrompt(runId);
      const text = (blocks: { type: string; text?: string; media_type?: string }[]) =>
        blocks.map((b) => (b.type === "text" ? (b.text ?? "") : `[${b.type}${b.media_type ? ` ${b.media_type}` : ""}]`)).join("\n\n");
      return { system: text(p.system), input: text(p.input) };
    },

    // Peek, not subscribe: it never advances the cursor. The scope comes from
    // the channel's own declaration, exactly as publish takes it.
    async peekChannel(channel, { scope, max }) {
      const { messages } = await client.peekChannel(channel, {
        scope: scope as Parameters<typeof client.peekChannel>[1]["scope"],
        maxMessages: max,
        ...(scope === "user" ? { userId: await selfUserId() } : {}),
      });
      return (messages ?? []).map((m) => ({ id: m.id, publishedAt: m.published_at, value: m.value }));
    },

    // A walk's run has no turns, so cancelTurn ENDS it and every run it
    // spawned (loomcycle #1341). Not caught: a 409 from an older runtime must
    // reach the canvas, which keeps the walk live and says why.
    async cancelWalk(runId, reason) {
      const { stopped } = await client.cancelTurn(runId, { reason });
      return { stopped };
    },

    async listChannels(): Promise<ChannelInfo[]> {
      const { channels } = await client.listChannels();
      return (channels ?? []).map((c) => ({
        name: c.name,
        scope: c.scope,
        hold: c.hold,
        // Names only, reduced here so an inline webhook's URL or headers
        // never reach the canvas at all.
        hooks: hookNamesOf(c.hooks),
        message_count: c.message_count,
        held_count: c.held_count,
        awaiting_hooks_count: c.awaiting_hooks_count,
        source: c.source,
      }));
    },

    // The Input node's pickers (x-loomcycle-picker): the board's own Document
    // wrappers, so the canvas package stays SDK-free.
    listDocuments: async ({ scope, underPath }) =>
      (await queryDocuments(client, scope, underPath)).documents.map((d) => ({ id: d.document_id, title: d.title })),
    listChunks: async (documentId, { scope }) =>
      (await queryChunks(client, scope, documentId)).chunks.map((c) => ({
        id: c.id,
        title: c.title,
        position: c.position,
        parent_id: c.parent_id ?? null,
      })),

    // The canvas resolves `scope` from the channel's own declaration and hands
    // it here; this adapter only supplies what that scope requires. A
    // user-scoped channel is addressed per user on the wire
    // (/v1/users/{id}/channels/{name}/publish), so it needs the id too.
    publishChannel: async (channel, payload, { scope }) =>
      client.publishChannel(channel, {
        scope: scope as Parameters<typeof client.publishChannel>[1]["scope"],
        payload,
        ...(scope === "user" ? { userId: await selfUserId() } : {}),
      }),
  };
}
