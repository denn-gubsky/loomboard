import type { ChunkRow } from "./workflowApi";

// Build a chunk tree from a Document's chunks (parent_id + position) for the
// left navigator. A chunk whose parent is the document root (or has no parent)
// is top-level; others nest under their parent. Ordered by `position`. Pure.

export interface ChunkNode {
  chunk: ChunkRow;
  children: ChunkNode[];
}

export function buildChunkTree(chunks: ChunkRow[], rootChunkId?: string): ChunkNode[] {
  const byId = new Map<string, ChunkNode>();
  for (const c of chunks) byId.set(c.id, { chunk: c, children: [] });

  const roots: ChunkNode[] = [];
  for (const c of chunks) {
    const node = byId.get(c.id)!;
    const parentId = c.parent_id;
    const parent =
      parentId && parentId !== rootChunkId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: ChunkNode[]) => {
    nodes.sort((a, b) => a.chunk.position - b.chunk.position);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
