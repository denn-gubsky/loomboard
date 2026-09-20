import { describe, it, expect } from "vitest";
import type { WhoamiResponse } from "@loomcycle/client";
import { deriveCapabilities, serverCapabilities, tokenKindLabel } from "./capabilities";

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

// `capabilities` rides on whoami (RFC AU) but isn't in the SDK's WhoamiResponse
// (1.72.0), so these go through the same undeclared-field narrow the app uses.
function whoWithCaps(caps: unknown): WhoamiResponse {
  return { ...who({}), capabilities: caps } as WhoamiResponse;
}

describe("serverCapabilities", () => {
  it("reads the runtime posture loomcycle advertises on whoami", () => {
    expect(
      serverCapabilities(
        whoWithCaps({
          mcp_allow_dynamic_stdio: true,
          http_host_allowlist_configured: false,
        }),
      ),
    ).toEqual({
      mcp_allow_dynamic_stdio: true,
      http_host_allowlist_configured: false,
    });
  });

  it("returns undefined when the runtime advertises nothing", () => {
    expect(serverCapabilities(who({}))).toBeUndefined();
    expect(serverCapabilities(null)).toBeUndefined();
  });

  it("omits a key an older runtime doesn't send rather than inventing false", () => {
    // false and absent mean different things to <Library>'s gate; absent must
    // not be flattened into an explicit deny that outlives a runtime upgrade.
    const out = serverCapabilities(whoWithCaps({ mcp_allow_dynamic_stdio: true }));
    expect(out).toEqual({ mcp_allow_dynamic_stdio: true });
    expect("http_host_allowlist_configured" in out!).toBe(false);
  });

  it("ignores non-boolean and malformed values instead of trusting the wire", () => {
    expect(serverCapabilities(whoWithCaps({ mcp_allow_dynamic_stdio: "true" }))).toEqual({});
    expect(serverCapabilities(whoWithCaps("nope"))).toBeUndefined();
    expect(serverCapabilities(whoWithCaps(null))).toBeUndefined();
  });
});
