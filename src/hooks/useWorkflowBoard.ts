import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamNameSummary } from "@loomcycle/client";
import { useLoomcycle } from "../state/connection";
import {
  queryDocuments,
  queryChunks,
  getChunk,
  updateChunkStatus,
  updateChunkFields,
  type BoardScope,
  type ChunkRow,
  type DocRow,
} from "../lib/workflowApi";
import { parseTeamGraph, type TeamGraph } from "../lib/teamGraph";
import { readBoardConfig, withBoardTeam } from "../lib/boardBinding";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The board Documents to pick from + the tenant's TeamDefs. */
export function useWorkflowLists(scope: BoardScope) {
  const client = useLoomcycle();
  const [boards, setBoards] = useState<DocRow[]>([]);
  const [teams, setTeams] = useState<TeamNameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [docs, ts] = await Promise.all([queryDocuments(client, scope), client.listTeams()]);
        if (cancelled) return;
        setBoards(docs.documents ?? []);
        setTeams(ts.names ?? []);
      } catch (e) {
        if (!cancelled) setError(msg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, scope, reloadKey]);

  return { boards, teams, loading, error, reload: () => setReloadKey((k) => k + 1) };
}

export interface BoardData {
  doc: DocRow;
  /** The bound TeamDef name (root-chunk fields.team), if any. */
  team?: string;
  /** The bound team's parsed graph — columns + transitions. */
  graph?: TeamGraph;
  /** Non-root chunks = the tasks. */
  tasks: ChunkRow[];
  /** The root chunk's revision — for the bind (fields) write. */
  rootRevision: number;
  /** The root chunk's fields — preserved when re-binding. */
  rootFields: Record<string, unknown>;
}

/** Load a selected board Document: its bound team + graph + task chunks, with
 *  bind-team and move-task (state transition) actions. */
export function useBoard(scope: BoardScope, doc: DocRow | null, teams: TeamNameSummary[]) {
  const client = useLoomcycle();
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // teams is used inside the loader; hold it in a ref so a new array identity
  // doesn't re-run the load (the values are stable per tenant).
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  useEffect(() => {
    if (!doc) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [root, chunksResp] = await Promise.all([
          getChunk(client, scope, doc.root_chunk_id),
          queryChunks(client, scope, doc.document_id),
        ]);
        if (cancelled) return;
        const cfg = readBoardConfig(root.fields);
        let graph: TeamGraph | undefined;
        if (cfg.team) {
          const summary = teamsRef.current.find((t) => t.name === cfg.team);
          if (summary?.active_def_id) {
            const detail = await client.getTeamDef(summary.active_def_id);
            if (cancelled) return;
            graph = parseTeamGraph(detail.definition);
          }
        }
        const tasks = (chunksResp.chunks ?? []).filter((c) => c.id !== doc.root_chunk_id);
        setData({
          doc,
          team: cfg.team,
          graph,
          tasks,
          rootRevision: root.revision,
          rootFields: root.fields ?? {},
        });
      } catch (e) {
        if (!cancelled) setError(msg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, scope, doc, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const bindTeam = useCallback(
    async (name: string | undefined) => {
      if (!doc || !data) return;
      await updateChunkFields(
        client,
        scope,
        doc.root_chunk_id,
        data.rootRevision,
        withBoardTeam(data.rootFields, name),
      );
      reload();
    },
    [client, scope, doc, data, reload],
  );

  const moveTask = useCallback(
    async (task: ChunkRow, toStatus: string) => {
      await updateChunkStatus(client, scope, task.id, task.revision, toStatus);
      reload();
    },
    [client, scope, reload],
  );

  // Lightweight live refresh: re-query just the task chunks (not the team graph /
  // root) so cards move as agents drive their status. Called on a timer while a
  // board is open; a transient failure keeps the prior tasks.
  const refreshTasks = useCallback(async () => {
    if (!doc) return;
    try {
      const r = await queryChunks(client, scope, doc.document_id);
      const tasks = (r.chunks ?? []).filter((c) => c.id !== doc.root_chunk_id);
      setData((d) => (d ? { ...d, tasks } : d));
    } catch {
      // Transient — keep the prior tasks; the next tick retries.
    }
  }, [client, scope, doc]);

  return { data, loading, error, reload, bindTeam, moveTask, refreshTasks };
}
