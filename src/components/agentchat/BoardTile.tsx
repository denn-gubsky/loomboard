import { useMemo } from "react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import { agentIdentity } from "../../lib/agentIdentity";
import { tileDisplayState, type RunTile } from "../../lib/runStates";
import { useInView, useTilePreview } from "../../hooks/useTilePreview";
import AgentChatTile from "./AgentChatTile";

// Glue between one live run and the presentational tile: derives the agent's
// identity, lazily loads the preview only while the tile is on-screen, and maps
// run status + pending question into the tile's display props.
export default function BoardTile({
  client,
  tile,
  question,
  onOpen,
}: {
  client: LoomcycleClient;
  tile: RunTile;
  question?: InterruptRow;
  onOpen: () => void;
}) {
  const identity = useMemo(() => agentIdentity(tile.agent), [tile.agent]);
  const [ref, inView] = useInView<HTMLDivElement>();
  const { lines, loading } = useTilePreview(client, tile.sessionId, tile.ts, inView);

  const state = tileDisplayState(tile, Boolean(question));
  const alert =
    tile.status === "failed" ? tile.error || "run failed" : undefined;

  return (
    <div ref={ref} className="agentchat-tile-wrap">
      <AgentChatTile
        agentName={tile.agent}
        Icon={identity.Icon}
        accentColor={identity.color}
        state={state}
        preview={lines}
        loadingPreview={loading && lines.length === 0}
        alert={alert}
        question={
          question ? question.question || "The agent is asking for input." : undefined
        }
        questionPriority={question?.priority}
        onOpen={onOpen}
      />
    </div>
  );
}
