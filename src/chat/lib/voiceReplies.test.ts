import { describe, expect, it } from "vitest";
import type { AssistantMessage, ChatMessage } from "./eventReducer";
import { replyToRead } from "./voiceReplies";

const user = (text: string): ChatMessage => ({ role: "user", text });
const reply = (text: string, status: AssistantMessage["status"] = "done"): ChatMessage => ({
  role: "assistant",
  status,
  parts: text ? [{ type: "text", text }] : [],
});

describe("replyToRead", () => {
  it("reads the reply of the turn, keyed by its index", () => {
    const messages = [user("Hi"), reply("Old answer."), user("Book a room"), reply("Booked for Friday.")];
    expect(replyToRead(messages, 2)).toEqual({ kind: "read", key: "3", text: "Booked for Friday." });
  });

  it("reads the last reply with something to say when the turn ended on tool calls", () => {
    const messages = [user("Book a room"), reply("Checking the calendar."), reply("")];
    expect(replyToRead(messages, 0)).toEqual({ kind: "read", key: "1", text: "Checking the calendar." });
  });

  it("waits while the newest reply is still settling", () => {
    expect(replyToRead([user("Book"), reply("Book", "streaming")], 0)).toEqual({ kind: "wait" });
  });

  it("reads nothing after a failed turn, or one before the voice message", () => {
    expect(replyToRead([user("Book"), reply("Partial", "error")], 0)).toEqual({ kind: "none" });
    expect(replyToRead([user("Hi"), reply("Old answer."), user("Book a room")], 2)).toEqual({ kind: "none" });
  });
});
