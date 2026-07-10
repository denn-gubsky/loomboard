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

// The message view model + a transcript→messages fold, so a host can render a
// read-only transcript (e.g. a compact preview tile) over the exact same shapes
// <Chat> uses, without mounting a full chat or duplicating the reducer.
export { foldTranscript } from "./lib/eventReducer";
export type {
  ChatMessage,
  UserMessage,
  AssistantMessage,
  MessagePart,
  ToolCall,
} from "./lib/eventReducer";
