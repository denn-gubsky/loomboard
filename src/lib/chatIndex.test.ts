import { describe, it, expect } from "vitest";
import type { Conversation } from "../state/conversations";
import type { HistoryChat } from "./historyTypes";
import { mergeChats, shouldRecap } from "./chatIndex";

function chat(p: Partial<HistoryChat> & { session_id: string }): HistoryChat {
  return {
    agent: "assistant",
    created_at: "2026-07-14T00:00:00Z",
    last_activity: "2026-07-14T00:00:00Z",
    run_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    cost: 0,
    ...p,
  };
}
function local(p: Partial<Conversation> & { id: string }): Conversation {
  return {
    title: "New chat",
    baseAgent: "",
    config: {},
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

describe("mergeChats", () => {
  it("uses the server session as the authority and joins the local agent/config by sessionId", () => {
    const s = chat({ session_id: "s1", title: "Server title", summary: "sum", status: "completed" });
    const l = local({ id: "l1", sessionId: "s1", baseAgent: "researcher", title: "stale local" });
    const [row] = mergeChats([s], [l]);
    expect(row).toMatchObject({
      key: "s1",
      sessionId: "s1",
      localId: "l1",
      title: "Server title", // server wins over local
      agent: "researcher", // agent/identity from local
      summary: "sum",
      status: "completed",
      source: "server",
    });
  });

  it("shows a server-only chat (started elsewhere) with no localId", () => {
    const [row] = mergeChats([chat({ session_id: "s1", title: "Elsewhere", agent: "planner" })], []);
    expect(row).toMatchObject({ sessionId: "s1", localId: undefined, agent: "planner", source: "server" });
  });

  it("shows an unsent local draft as its own row", () => {
    const [row] = mergeChats([], [local({ id: "d1", title: "Draft", baseAgent: "coder" })]);
    expect(row).toMatchObject({ key: "d1", localId: "d1", sessionId: undefined, source: "draft", title: "Draft" });
  });

  it("keeps a local sent chat that isn't in the loaded server page", () => {
    const l = local({ id: "l1", sessionId: "s9", title: "Just created", updatedAt: 5 });
    const [row] = mergeChats([], [l]);
    expect(row).toMatchObject({ sessionId: "s9", localId: "l1", source: "server", title: "Just created" });
  });

  it("keeps an archived session flagged (for the Archived view) without duplicating it from a local record", () => {
    const s = chat({ session_id: "s1", archived: true, title: "Archived" });
    const l = local({ id: "l1", sessionId: "s1", title: "archived-local" });
    const rows = mergeChats([s], [l]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "s1", archived: true, localId: "l1" });
  });

  it("sorts pinned first, then most-recent", () => {
    const rows = mergeChats(
      [
        chat({ session_id: "old", last_activity: "2026-07-10T00:00:00Z" }),
        chat({ session_id: "new", last_activity: "2026-07-14T00:00:00Z" }),
        chat({ session_id: "pin", last_activity: "2026-07-01T00:00:00Z", pinned: true }),
      ],
      [],
    );
    expect(rows.map((r) => r.key)).toEqual(["pin", "new", "old"]);
  });
});

describe("shouldRecap", () => {
  it("recaps a long chat that has had new turns since the last recap", () => {
    expect(shouldRecap({ runCount: 5 }, 3)).toBe(true);
  });
  it("skips short chats", () => {
    expect(shouldRecap({ runCount: 2 }, 0)).toBe(false);
  });
  it("skips when no new turns happened since the last recap", () => {
    expect(shouldRecap({ runCount: 5 }, 5)).toBe(false);
  });
});
