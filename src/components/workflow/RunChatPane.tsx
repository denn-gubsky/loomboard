import { useCallback, useEffect, useState } from "react";
import type { LoomcycleClient } from "@loomcycle/client";
import type { RunChatTarget } from "@loomboard/workflow";
import { Chat, type ChatConversation, type Connection } from "../../chat";

// The canvas's Run-mode chat for ONE member run of a team walk: its full
// transcript, and a composer.
//
// A member is an ordinary run with its own session, so <Chat> opens it like
// any conversation — the transcript by session, the live tail by run id.
// The session id is looked up from the run: run-state events don't carry it,
// so a member first seen on the stream has none on its row.
//
// What a typed message does depends on the run:
//   - running: <Chat> steers it (sendRunInput). The agent reads it after its
//     current step. One sent while it writes its final answer is answered
//     before the run ends (loomcycle 1.103.0, gap G16), so the answer the
//     walk collects is the one that took the message into account.
//   - finished: <Chat> continues the session (continueSession), a NEW run
//     outside the walk — the walk does not see its answer.
// The note above the chat says which, so neither surprises anyone.

export function RunChatPane({
  connection,
  client,
  target,
}: {
  connection: Connection;
  client: LoomcycleClient;
  target: RunChatTarget;
}) {
  const [conv, setConv] = useState<ChatConversation>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    client
      .getRun(target.runId)
      .then((a) => {
        if (cancelled) return;
        setConv({
          id: target.runId,
          title: target.agent,
          baseAgent: target.agent,
          config: {},
          runId: target.runId,
          sessionId: a.session_id,
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [client, target.runId, target.agent]);

  const onConversationChange = useCallback(
    (patch: Partial<ChatConversation>) => setConv((c) => (c ? { ...c, ...patch } : c)),
    [],
  );

  return (
    <div className="run-chat-pane">
      <p className="run-chat-pane__note">
        {target.live
          ? "Running — the agent reads a message after its current step, and answers it before it finishes."
          : "This run has finished — a message starts a new turn in its session, outside the walk."}
      </p>
      {error && <p className="run-chat-pane__error">Could not open this run: {error}</p>}
      {conv && (
        <div className="run-chat-pane__chat">
          <Chat connection={connection} conversation={conv} onConversationChange={onConversationChange} />
        </div>
      )}
    </div>
  );
}
