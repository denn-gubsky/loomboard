import { describe, it, expect } from "vitest";
import type { WhoamiResponse } from "@loomcycle/client";
import { accessSummary, deriveCapabilities, serverCapabilities, tokenKindLabel } from "./capabilities";

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

// Every gated view at once: the scope fallback opens or closes them together.
const ALL = (v: boolean) => ({ library: v, documents: v, memory: v, boards: v, workflow: v, canvas: v, users: v });

describe("deriveCapabilities", () => {
  it("opens every view to admin / operator / open / legacy on a server without the surface summary", () => {
    expect(deriveCapabilities(who({ is_admin: true })).views).toEqual(ALL(true));
    expect(deriveCapabilities(who({ scopes: ["substrate:tenant"] })).views).toEqual(ALL(true));
    expect(deriveCapabilities(who({ open_mode: true })).views).toEqual(ALL(true));
    expect(deriveCapabilities(who({ legacy: true })).views).toEqual(ALL(true));
  });

  it("opens every view to a non-isolated member and none to an isolated user without the summary (RFC CB)", () => {
    const member = deriveCapabilities(who({ scopes: ["runs:create", "runs:read", "channel:publish", "channel:read"] }));
    expect(member.views).toEqual({ ...ALL(true), users: false });
    expect(member.isIsolated).toBe(false);

    const isolated = deriveCapabilities(who({ scopes: ["substrate:user"] }));
    expect(isolated.views).toEqual(ALL(false));
    expect(isolated.isIsolated).toBe(true);

    // A member who ALSO holds substrate:tenant is not isolated.
    const both = deriveCapabilities(who({ scopes: ["substrate:user", "substrate:tenant"] }));
    expect(both.views).toEqual(ALL(true));
    expect(both.isIsolated).toBe(false);
  });

  it("shows only the views whose loomcycle pages the access rules let the principal reach", () => {
    // An operator whose rules deny teams and memory: scopes alone would open
    // everything.
    const p = who({
      scopes: ["substrate:tenant"],
      effective: { surfaces: { library: true, paths: true, memory: false, teams: false, run: true } },
    });
    expect(deriveCapabilities(p).views).toEqual({
      library: true,
      documents: true,
      memory: false,
      boards: true,
      workflow: false,
      canvas: false,
      users: true,
    });
  });

  it("opens a view to an isolated user when loomcycle says its pages are reachable", () => {
    const p = who({ scopes: ["substrate:user"], effective: { surfaces: { library: true, paths: true, memory: true, teams: true } } });
    expect(deriveCapabilities(p).views).toEqual({ ...ALL(true), users: false });
  });

  it("closes Workflow when either of its pages is refused", () => {
    const docsOnly = who({ effective: { surfaces: { library: true, paths: true, memory: true, teams: false } } });
    const teamsOnly = who({ effective: { surfaces: { library: true, paths: false, memory: true, teams: true } } });
    expect(deriveCapabilities(docsOnly).views.workflow).toBe(false);
    expect(deriveCapabilities(teamsOnly).views.workflow).toBe(false);
  });

  it("falls back to the scope rule for a page the server leaves out of the summary", () => {
    const member = who({ scopes: ["runs:create"], effective: { surfaces: { memory: false } } });
    expect(deriveCapabilities(member).views).toEqual({ ...ALL(true), memory: false, users: false });
    const isolated = who({ scopes: ["substrate:user"], effective: { surfaces: { library: true } } });
    expect(deriveCapabilities(isolated).views).toEqual({ ...ALL(false), library: true });
  });

  it("opens Users only to an operator when the server sends no summary, and as the summary says when it does", () => {
    expect(deriveCapabilities(who({ scopes: ["substrate:tenant"] })).views.users).toBe(true);
    expect(deriveCapabilities(who({ scopes: ["runs:create"] })).views.users).toBe(false);
    // An operator the access rules keep off the users list.
    const denied = who({ scopes: ["substrate:tenant"], effective: { surfaces: { users: false } } });
    expect(deriveCapabilities(denied).views.users).toBe(false);
  });

  it("null principal → no capabilities", () => {
    expect(deriveCapabilities(null)).toEqual({ views: ALL(false), isAdmin: false, isIsolated: false });
  });
});

describe("accessSummary", () => {
  it("says how the principal is connected and which access rules apply", () => {
    const p = who({ acl_mode: "enforce", acl_version: 12, groups: ["eng", "ops"], auth: { mode: "strict", gate: "github" } });
    expect(accessSummary(p, true).split("\n")).toEqual([
      "Signed in with loomcycle",
      "Sign-in option: github",
      "Access rules: enforce (v12)",
      "Groups: eng, ops",
    ]);
  });

  it("names a pasted token and leaves out what the server did not send", () => {
    expect(accessSummary(who({}), false)).toBe("Connected with a token");
    expect(accessSummary(who({ acl_mode: "compat", groups: [] }), false)).toBe("Connected with a token\nAccess rules: compat");
    expect(accessSummary(null, false)).toBe("");
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
