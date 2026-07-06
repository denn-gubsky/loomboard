// The single conversation the side panel drives (the extension is one chat, not
// a list). Persisted in chrome.storage.local so the chat resumes across panel
// opens. baseAgent is pinned to the browser-assistant agent by the panel.

import type { ChatConversation } from "../chat";
import { storageGet, storageSet } from "./chromeStorage";

const KEY = "loomboard.conversation";

/** The agent the side-panel assistant runs against. Empty in M1 (the picker
 *  guides the user); pinned to "chrome-assistant" once ensureAgent lands. */
export const ASSISTANT_AGENT = "";

export function newConversation(): ChatConversation {
  return {
    id: crypto.randomUUID(),
    title: "Assistant",
    baseAgent: ASSISTANT_AGENT,
    config: {},
  };
}

export async function loadConversation(): Promise<ChatConversation> {
  const c = await storageGet<ChatConversation>(KEY);
  return c && typeof c.id === "string" ? c : newConversation();
}

export async function persistConversation(c: ChatConversation): Promise<void> {
  await storageSet(KEY, c);
}
