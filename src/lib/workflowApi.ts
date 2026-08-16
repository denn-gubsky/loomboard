import type { LoomcycleClient, DocumentToolInput } from "@loomcycle/client";

// Thin typed wrappers over the loomcycle Document tool for the workflow board.
// `DocumentToolResponse` is `unknown`, so the response shapes are the board's own
// contract (transcribed from the runtime's document.go responses). A board is any
// Document; its chunks are the tasks; `chunk.status` is the kanban column.

export type BoardScope = "user" | "tenant";

export interface DocRow {
  document_id: string;
  title: string;
  root_chunk_id: string;
  type?: string;
  status?: string;
  updated_at?: number;
}
export interface ChunkRow {
  id: string;
  document_id: string;
  title: string;
  position: number;
  revision: number;
  parent_id?: string;
  type?: string;
  status?: string;
}
export interface ChunkDetail extends ChunkRow {
  body?: string;
  fields?: Record<string, unknown>;
  tags?: string[];
}

// The Document tool op union in the pinned client predates nothing we use here,
// but scope is a narrowed string; the runtime passes op+scope verbatim and
// DocumentToolInput carries a `[extra]: unknown` index signature, so the cast is
// sound (same pattern the @loomcycle/loomboard data layer uses).
function doc<T>(client: LoomcycleClient, input: Record<string, unknown>): Promise<T> {
  return client.document(input as DocumentToolInput).then((r) => r as T);
}

export function queryDocuments(
  client: LoomcycleClient,
  scope: BoardScope,
): Promise<{ documents: DocRow[] }> {
  return doc(client, { op: "query_documents", scope });
}

export function queryChunks(
  client: LoomcycleClient,
  scope: BoardScope,
  documentId: string,
): Promise<{ chunks: ChunkRow[] }> {
  return doc(client, { op: "query_chunks", scope, document_id: documentId });
}

export function getChunk(
  client: LoomcycleClient,
  scope: BoardScope,
  id: string,
): Promise<ChunkDetail> {
  return doc(client, { op: "get_chunk", scope, id });
}

export function updateChunkStatus(
  client: LoomcycleClient,
  scope: BoardScope,
  id: string,
  revision: number,
  status: string,
): Promise<unknown> {
  return doc(client, { op: "update_chunk", scope, id, revision, status });
}

export function updateChunkFields(
  client: LoomcycleClient,
  scope: BoardScope,
  id: string,
  revision: number,
  fields: Record<string, unknown>,
): Promise<unknown> {
  return doc(client, { op: "update_chunk", scope, id, revision, fields });
}
