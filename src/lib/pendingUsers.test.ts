import { describe, expect, it } from "vitest";
import type { UserSummary } from "@loomcycle/client";
import { pendingUsers } from "./pendingUsers";

function user(user_id: string, status: string, display_name?: string): UserSummary {
  return { user_id, status, display_name, running_count: 0, total_count: 0, last_started_at: "" };
}

describe("pendingUsers", () => {
  it("keeps only the users awaiting approval, ordered by name", () => {
    const list = [
      user("github:2", "pending", "Zoe"),
      user("ada", "active", "Ada"),
      user("runs-only", ""),
      user("oidc:7", "pending"),
      user("bob", "disabled"),
      user("github:1", "pending", "Ada L."),
    ];
    expect(pendingUsers(list).map((u) => u.user_id)).toEqual(["github:1", "oidc:7", "github:2"]);
  });
});
