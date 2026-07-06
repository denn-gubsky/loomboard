// The single conversation the side panel drives (the extension is one chat, not
// a list). Persisted in chrome.storage.local so the chat resumes across panel
// opens. baseAgent is pinned to the browser-assistant agent by the panel.

import type { ChatConversation } from "../chat";
import { ASSISTANT_AGENT } from "../bridge/protocol";
import { storageGet, storageSet } from "./chromeStorage";

const KEY = "loomboard.conversation";

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
