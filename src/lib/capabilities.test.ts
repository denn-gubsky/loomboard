import { describe, it, expect } from "vitest";
import type { WhoamiResponse } from "@loomcycle/client";
import { deriveCapabilities, tokenKindLabel } from "./capabilities";

function who(p: Partial<WhoamiResponse>): WhoamiResponse {
  return {
    tenant_id: "t",
    subject: "s",
    scopes: [],
    is_admin: false,
    legacy: false,
    ...p,
  };
}

describe("deriveCapabilities", () => {
  it("grants tenant reach to admin / operator / open / legacy", () => {
    expect(deriveCapabilities(who({ is_admin: true })).canTenant).toBe(true);
    expect(deriveCapabilities(who({ scopes: ["substrate:tenant"] })).canTenant).toBe(true);
    expect(deriveCapabilities(who({ open_mode: true })).canTenant).toBe(true);
    expect(deriveCapabilities(who({ legacy: true })).canTenant).toBe(true);
  });

  it("grants tenant reach to a non-isolated member, confines an isolated user (RFC CB)", () => {
    // A tenant-mode (member) user token: runs/channels, not isolated → reaches
    // the tenant plane now that loomcycle admits members on those routes.
    const member = deriveCapabilities(who({ scopes: ["runs:create", "runs:read", "channel:publish", "channel:read"] }));
    expect(member.canTenant).toBe(true);
    expect(member.isIsolated).toBe(false);

    // An isolated substrate:user token stays confined.
    const isolated = deriveCapabilities(who({ scopes: ["substrate:user"] }));
    expect(isolated.canTenant).toBe(false);
    expect(isolated.isIsolated).toBe(true);

    // A member who ALSO holds substrate:user (both) is not isolated → reaches it.
    const both = deriveCapabilities(who({ scopes: ["substrate:user", "substrate:tenant"] }));
    expect(both.canTenant).toBe(true);
    expect(both.isIsolated).toBe(false);
  });

  it("null principal → no capabilities", () => {
    expect(deriveCapabilities(null)).toEqual({ canTenant: false, isAdmin: false, isIsolated: false });
  });
});

describe("tokenKindLabel", () => {
  it("labels the identity kind", () => {
    expect(tokenKindLabel(who({ open_mode: true }))).toBe("open");
    expect(tokenKindLabel(who({ is_admin: true }))).toBe("admin");
    expect(tokenKindLabel(who({ scopes: ["substrate:tenant"] }))).toBe("operator");
    expect(tokenKindLabel(who({ scopes: ["substrate:user"] }))).toBe("isolated");
    expect(tokenKindLabel(who({ scopes: ["runs:create"] }))).toBe("user");
    expect(tokenKindLabel(null)).toBe("");
  });
});
