// Public API of @loomboard/chat. Keep this surface small and intentional — it's
// the contract consumers depend on.
//
// Styles ship separately: `import "@loomboard/chat/styles.css"`.

export { default as Chat } from "./Chat";
export type { ChatProps } from "./Chat";

export type { ChatConversation, ConversationConfig } from "./types";
export { configIsCustom, sameConfig } from "./types";

export { createLoomcycleClient } from "./lib/createClient";
export type { Connection } from "./lib/createClient";
