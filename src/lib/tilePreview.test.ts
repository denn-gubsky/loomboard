import { describe, it, expect } from "vitest";
import type { ChatMessage, MessagePart } from "../chat";
import { previewFromMessages } from "./tilePreview";

const user = (text: string): ChatMessage => ({ role: "user", text });
const assistant = (...parts: MessagePart[]): ChatMessage => ({
  role: "assistant",
  status: "done",
  parts,
});

describe("previewFromMessages", () => {
  it("keeps only the last N lines, oldest→newest", () => {
    const msgs: ChatMessage[] = [
      user("one"),
      assistant({ type: "text", text: "two" }),
      user("three"),
      assistant({ type: "text", text: "four" }),
    ];
    const lines = previewFromMessages(msgs, 2);
    expect(lines.map((l) => l.text)).toEqual(["three", "four"]);
  });

  it("collapses a tool part to a one-line chip with the tool name", () => {
    const msgs: ChatMessage[] = [
      assistant({ type: "tool", call: { id: "t1", name: "read_page", input: {} } }),
    ];
    expect(previewFromMessages(msgs, 3)).toEqual([
      { role: "assistant", kind: "tool", text: "read_page" },
    ]);
  });

  it("collapses thinking to a placeholder (never dumps reasoning text)", () => {
    const msgs: ChatMessage[] = [
      assistant({ type: "thinking", text: "long private chain of thought" }),
    ];
    expect(previewFromMessages(msgs, 3)).toEqual([
      { role: "assistant", kind: "thinking", text: "thinking…" },
    ]);
  });

  it("truncates long text and collapses whitespace", () => {
    const msgs: ChatMessage[] = [user("a  b\n\n c   d " + "x".repeat(200))];
    const [line] = previewFromMessages(msgs, 1, 20);
    expect(line.text.length).toBe(20);
    expect(line.text.endsWith("…")).toBe(true);
    expect(line.text.startsWith("a b c d")).toBe(true);
  });

  it("drops empty/whitespace-only text parts", () => {
    const msgs: ChatMessage[] = [
      user("   "),
      assistant({ type: "text", text: "" }, { type: "text", text: "kept" }),
    ];
    expect(previewFromMessages(msgs, 3)).toEqual([
      { role: "assistant", kind: "text", text: "kept" },
    ]);
  });

  it("orders interleaved assistant parts (thinking → tool → text)", () => {
    const msgs: ChatMessage[] = [
      assistant(
        { type: "thinking", text: "hmm" },
        { type: "tool", call: { id: "t1", name: "search", input: {} } },
        { type: "text", text: "found it" },
      ),
    ];
    expect(previewFromMessages(msgs, 3).map((l) => l.kind)).toEqual([
      "thinking",
      "tool",
      "text",
    ]);
  });
});
