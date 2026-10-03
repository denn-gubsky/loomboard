import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@loomcycle/client";
import { runLineFolder } from "./runLines";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as AgentEvent;

describe("runLineFolder", () => {
  it("reads a member run's stream the way the chat does — text, tools, thinking — as its last lines", () => {
    const f = runLineFolder(3);
    f.push(ev("agent", { run_id: "m1", session_id: "s1" }));
    f.push(ev("thinking", { text: "hmm" }));
    f.push(ev("tool_call", { tool_use: { id: "t1", name: "WebSearch", input: {} } }));
    const lines = f.push(ev("text", { text: "The Ryzen 7 7800X3D is" }));
    expect(lines).toEqual([
      { role: "assistant", kind: "thinking", text: "thinking…" },
      { role: "assistant", kind: "tool", text: "WebSearch" },
      { role: "assistant", kind: "text", text: "The Ryzen 7 7800X3D is" },
    ]);
  });

  it("reports nothing when a frame changes no line — so a node is not redrawn for it", () => {
    const f = runLineFolder(3);
    expect(f.push(ev("text", { text: "a" }))).toBeDefined();
    expect(f.push(ev("agent", { run_id: "m1" }))).toBeUndefined();
  });
});
