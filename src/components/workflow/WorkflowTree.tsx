import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChunkRow } from "../../lib/workflowApi";
import { buildChunkTree, type ChunkNode } from "../../lib/chunkTree";

// The board Document's chunk tree — sections (preamble, steps, …) with their
// child tasks. Every node is selectable (highlights the section) and draggable
// (drag its child tasks onto the board to place them in a state). The drag
// carries the chunk id via dataTransfer, so the board's drop handler works
// uniformly for a tree drag or a card-to-card move.

function TreeNode({
  node,
  depth,
  sectionId,
  onSelectSection,
  onDragStart,
  onDragEnd,
}: {
  node: ChunkNode;
  depth: number;
  sectionId: string | null;
  onSelectSection: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(depth < 1); // top level expanded by default
  const c = node.chunk;
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className={sectionId === c.id ? "wf-tree-row on" : "wf-tree-row"}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart(c.id);
        }}
        onDragEnd={onDragEnd}
        onClick={() => {
          onSelectSection(c.id);
          if (hasChildren) setOpen((o) => !o);
        }}
        title={c.title}
      >
        {hasChildren ? (
          <ChevronRight size={13} className={open ? "wf-tree-chev open" : "wf-tree-chev"} />
        ) : (
          <span className="wf-tree-dot" />
        )}
        <span className="wf-tree-title">{c.title || "(untitled)"}</span>
        {c.status && <span className="wf-tree-status">{c.status}</span>}
      </div>
      {hasChildren && open && (
        <ul className="wf-tree-children">
          {node.children.map((ch) => (
            <TreeNode
              key={ch.chunk.id}
              node={ch}
              depth={depth + 1}
              sectionId={sectionId}
              onSelectSection={onSelectSection}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function WorkflowTree({
  tasks,
  rootChunkId,
  sectionId,
  onSelectSection,
  onDragStart,
  onDragEnd,
}: {
  tasks: ChunkRow[];
  rootChunkId?: string;
  sectionId: string | null;
  onSelectSection: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const tree = useMemo(() => buildChunkTree(tasks, rootChunkId), [tasks, rootChunkId]);
  if (tree.length === 0) return <div className="wf-dim">No sections in this document.</div>;
  return (
    <ul className="wf-tree">
      {tree.map((n) => (
        <TreeNode
          key={n.chunk.id}
          node={n}
          depth={0}
          sectionId={sectionId}
          onSelectSection={onSelectSection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      ))}
    </ul>
  );
}
