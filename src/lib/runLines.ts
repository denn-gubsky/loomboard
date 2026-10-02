import type { AgentEvent } from "@loomcycle/client";
import { chatReducer, initialChatState, type ChatState } from "../chat/lib/eventReducer";
import type { ChatEvent } from "../chat/lib/events";
import { previewFromMessages, type PreviewLine } from "./tilePreview";

// A member run's stream (streamRunByID) → the few lines its canvas node shows.
//
// Folded through the chat's own reducer, so a node reads a run exactly as the
// chat tile and the chat do — no second interpretation of the wire — and then
// cut to the tile's preview lines. Pure: the host's watcher feeds it frames.

export interface RunLineFolder {
  /** Fold one frame; the new lines when they changed, else undefined. */
  push(ev: AgentEvent): PreviewLine[] | undefined;
}

export function runLineFolder(maxLines = 3): RunLineFolder {
  let state: ChatState = initialChatState;
  let last = "";
  return {
    push(ev) {
      state = chatReducer(state, { kind: "event", event: ev as ChatEvent });
      const lines = previewFromMessages(state.messages, maxLines);
      const key = JSON.stringify(lines);
      if (key === last) return undefined;
      last = key;
      return lines;
    },
  };
}
