import { useState } from "react";
import type { LoomcycleClient } from "@loomcycle/client";
import type { Connection } from "../../chat";
import { useUserRunStates } from "../../hooks/useUserRunStates";
import { useUserInterrupts } from "../../hooks/useUserInterrupts";
import { agentIdentity } from "../../lib/agentIdentity";
import BoardTile from "./BoardTile";
import AgentChatOverlay from "./AgentChatOverlay";

// A responsive grid of compact agent-chat tiles fed by the live run portfolio —
// ONE aggregate run-state stream + ONE interrupts poll for all tiles; a per-run
// transcript fetch happens only for on-screen tiles, and the full <Chat> stream
// only for the enlarged one. This is a verification harness / reference wiring,
// not the product board (RFC AC's document-kanban will place these tiles).
export default function AgentPortfolioGrid({
  client,
  connection,
  userId,
}: {
  client: LoomcycleClient;
  connection: Connection;
  userId: string;
}) {
  const { tiles, connected } = useUserRunStates(client, userId);
  const interrupts = useUserInterrupts(client, userId);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const openTile = tiles.find((t) => t.runId === openRunId) ?? null;
  const openQuestion = openRunId ? interrupts.get(openRunId) : undefined;

  return (
    <section className="agentboard">
      <div className="agentboard-head">
        <span
          className={`agentboard-conn ${connected ? "on" : "off"}`}
          title={connected ? "live" : "connecting…"}
        />
        <span>
          {tiles.length} run{tiles.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="agentboard-grid">
        {tiles.map((t) => (
          <BoardTile
            key={t.runId}
            client={client}
            tile={t}
            question={interrupts.get(t.runId)}
            onOpen={() => setOpenRunId(t.runId)}
          />
        ))}
        {tiles.length === 0 && (
          <div className="agentboard-empty">No agent runs yet.</div>
        )}
      </div>

      {openTile && (
        <AgentChatOverlay
          key={openTile.runId}
          connection={connection}
          client={client}
          tile={openTile}
          identity={agentIdentity(openTile.agent)}
          question={openQuestion}
          onClose={() => setOpenRunId(null)}
        />
      )}
    </section>
  );
}
