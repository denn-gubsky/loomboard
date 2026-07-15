import { describe, it, expect } from "vitest";
import type { Agent } from "@loomcycle/client";
import { pickCancelableAgent } from "./runControl";

function agent(p: Partial<Agent> & { agent_id: string; session_id: string }): Agent {
  return {
    run_id: p.agent_id,
    parent_agent_id: null,
    status: "running",
    started_at: "2026-07-14T00:00:00Z",
    ...p,
  } as Agent;
}

describe("pickCancelableAgent", () => {
  it("returns '' when no agent belongs to the session", () => {
    expect(pickCancelableAgent([agent({ agent_id: "a1", session_id: "other" })], "s1")).toBe("");
  });

  it("prefers a live (non-terminal) root agent for the session", () => {
    const agents = [
      agent({ agent_id: "done", session_id: "s1", status: "completed" }),
      agent({ agent_id: "live", session_id: "s1", status: "running" }),
    ];
    expect(pickCancelableAgent(agents, "s1")).toBe("live");
  });

  it("ignores children and picks the root (cancel cascades to children)", () => {
    const agents = [
      agent({ agent_id: "child", session_id: "s1", status: "running", parent_agent_id: "root" }),
      agent({ agent_id: "root", session_id: "s1", status: "running", parent_agent_id: null }),
    ];
    expect(pickCancelableAgent(agents, "s1")).toBe("root");
  });

  it("falls back to the most recently started root when all are terminal", () => {
    const agents = [
      agent({ agent_id: "old", session_id: "s1", status: "completed", started_at: "2026-07-10T00:00:00Z" }),
      agent({ agent_id: "new", session_id: "s1", status: "cancelled", started_at: "2026-07-14T00:00:00Z" }),
    ];
    expect(pickCancelableAgent(agents, "s1")).toBe("new");
  });

  it("uses non-root agents only when the session has no root", () => {
    const agents = [
      agent({ agent_id: "c1", session_id: "s1", status: "running", parent_agent_id: "missing" }),
    ];
    expect(pickCancelableAgent(agents, "s1")).toBe("c1");
  });
});
