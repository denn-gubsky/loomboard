import { useMemo, useState } from "react";
import { useConversations, type Conversation } from "../state/conversations";
import { useConnection, useLoomcycle } from "../state/connection";
import { deleteConversationAgent } from "../chat/lib/agentFork";
import { useUserRunStates } from "../hooks/useUserRunStates";
import { useUserInterrupts } from "../hooks/useUserInterrupts";
import ConversationTile from "./agentchat/ConversationTile";

// The left panel: each chat the user has started rendered as a MINIMIZED live
// tile (agent identity + status pulse + a tiny transcript preview + alert /
// question badges), so you can watch many chats at once. Live state comes from a
// SINGLE aggregate run-state stream + one interrupts poll, joined to each
// conversation by runId — not one stream per tile. Click a tile to select it
// (the main pane expands it).
export default function ConversationList({ collapsed }: { collapsed: boolean }) {
  const { conversations, activeId, select, remove } = useConversations();
  const client = useLoomcycle();
  const { principal } = useConnection();
  const userId = principal?.subject ?? null;

  const { tiles } = useUserRunStates(client, userId);
  const interrupts = useUserInterrupts(client, userId);
  const runByRunId = useMemo(
    () => new Map(tiles.map((t) => [t.runId, t])),
    [tiles],
  );

  // Two-step inline delete (not window.confirm — Tauri webviews no-op it).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function doDelete(c: Conversation) {
    if (c.forkDefName) void deleteConversationAgent(client, c.forkDefName);
    remove(c.id);
    setConfirmingId(null);
  }

  if (conversations.length === 0) {
    return <p className="convo-empty">No conversations yet.</p>;
  }

  // Newest activity first.
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className={collapsed ? "conv-tiles collapsed" : "conv-tiles"}>
      {sorted.map((c) => (
        <ConversationTile
          key={c.id}
          conversation={c}
          client={client}
          collapsed={collapsed}
          runState={c.runId ? runByRunId.get(c.runId) : undefined}
          question={c.runId ? interrupts.get(c.runId) : undefined}
          active={c.id === activeId}
          confirming={confirmingId === c.id}
          onSelect={() => {
            setConfirmingId(null);
            select(c.id);
          }}
          onRequestDelete={() => setConfirmingId(c.id)}
          onCancelDelete={() => setConfirmingId(null)}
          onConfirmDelete={() => doDelete(c)}
        />
      ))}
    </div>
  );
}
