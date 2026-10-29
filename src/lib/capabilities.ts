import type { WhoamiResponse } from "@loomcycle/client";
import type { ServerCapabilities } from "@loomcycle/library";

// What the connected principal can reach. loomcycle answers that itself
// (RFC EZ §4): GET /v1/_me `effective.surfaces` says, per Web UI page, whether
// a request to the route the page loads first would pass the route's scope
// gate AND its access-control rules. That is the only source that sees the
// rules, so a view is shown when its pages are reachable.
//
// A server older than the summary (or one that leaves a page out) falls back
// to the scope rule (RFC BX / RFC CB): the tenant plane is reachable by every
// NON-isolated principal — an operator, an admin, open/legacy, or a member —
// and only an isolated `substrate:user` token is confined.

/** The views a principal may or may not reach. Chat is not among them: it is
 *  the view the app falls back to. */
export type GatedView = "library" | "documents" | "memory" | "boards" | "workflow" | "canvas";

// Each view's loomcycle pages, keyed as internal/api/http/nav_capabilities.go
// keys them: the pages whose primary route is the view's own first call.
// Documents and Boards read Documents, which loomcycle gates as "read
// document", the paths page's question. Workflow loads its boards and the team
// list together and shows nothing if either is refused, so it needs both.
const VIEW_SURFACES: Record<GatedView, readonly string[]> = {
  library: ["library"],
  documents: ["paths"],
  memory: ["memory"],
  boards: ["paths"],
  workflow: ["paths", "teams"],
  canvas: ["teams"],
};

export interface Capabilities {
  /** Per view, whether the principal may reach it. */
  views: Record<GatedView, boolean>;
  /** Full admin — all tenants. */
  isAdmin: boolean;
  /** A substrate:user token, confined to its own user scope server-side. */
  isIsolated: boolean;
}

export function deriveCapabilities(p: WhoamiResponse | null): Capabilities {
  const scopes = p?.scopes ?? [];
  const isAdmin = Boolean(p?.is_admin);
  // Isolated = a substrate:user token (RFC BX), confined to its own user scope
  // server-side. Mirrors loomcycle's auth.IsIsolated: substrate:user AND neither
  // substrate:tenant nor admin.
  const isIsolated =
    scopes.includes("substrate:user") &&
    !scopes.includes("substrate:tenant") &&
    !isAdmin;
  const canTenant = Boolean(p) && !isIsolated;
  const surfaces = p?.effective?.surfaces;
  const reach = (page: string) => Boolean(p) && (surfaces?.[page] ?? canTenant);
  const views = Object.fromEntries(
    Object.entries(VIEW_SURFACES).map(([v, pages]) => [v, pages.every(reach)]),
  ) as Record<GatedView, boolean>;
  return { views, isAdmin, isIsolated };
}

/** How the principal is connected and which access rules apply, one line
 *  each — the sidebar badge's tooltip. `signedIn` is whether loomboard holds a
 *  "Sign in with loomcycle" session rather than a pasted token. */
export function accessSummary(p: WhoamiResponse | null, signedIn: boolean): string {
  if (!p) return "";
  const lines = [signedIn ? "Signed in with loomcycle" : "Connected with a token"];
  if (p.auth?.gate) lines.push(`Sign-in option: ${p.auth.gate}`);
  if (p.acl_mode) {
    lines.push(`Access rules: ${p.acl_mode}${p.acl_version !== undefined ? ` (v${p.acl_version})` : ""}`);
  }
  if (p.groups?.length) lines.push(`Groups: ${p.groups.join(", ")}`);
  return lines.join("\n");
}

/** Short label for the connected identity's kind — for the sidebar badge. */
export function tokenKindLabel(p: WhoamiResponse | null): string {
  if (!p) return "";
  if (p.open_mode) return "open";
  if (p.is_admin) return "admin";
  if (p.scopes?.includes("substrate:tenant")) return "operator";
  if (p.scopes?.includes("substrate:user")) return "isolated";
  return "user";
}

// The runtime posture loomcycle advertises on /v1/_me alongside the principal
// (RFC AU): booleans only — whether a tenant may import a stdio MCP server, and
// whether ANY http host allowlist is configured. Deliberately non-secret; the
// server never puts allowlist CONTENTS on this wire, so it is safe to hand
// straight to the UI.
//
// It is read off an UNDECLARED field: loomcycle has returned `capabilities` on
// whoami since RFC AU, but @loomcycle/client's WhoamiResponse still doesn't
// declare it (still absent at 1.84.0). Hence the narrow rather than a property
// access — drop it once the SDK type catches up.
//
// <Library> gates on `mcp_allow_dynamic_stdio === true`, so omitting this prop
// isn't neutral: it pins the gate closed and hides the stdio MCP import path
// even on a runtime whose operator enabled it.
export function serverCapabilities(
  p: WhoamiResponse | null,
): ServerCapabilities | undefined {
  const raw = (p as { capabilities?: unknown } | null)?.capabilities;
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const out: ServerCapabilities = {};
  // Copy only the booleans we know: an older runtime omits a key, and a newer
  // one may add others we shouldn't forward blind.
  if (typeof c.mcp_allow_dynamic_stdio === "boolean") {
    out.mcp_allow_dynamic_stdio = c.mcp_allow_dynamic_stdio;
  }
  if (typeof c.http_host_allowlist_configured === "boolean") {
    out.http_host_allowlist_configured = c.http_host_allowlist_configured;
  }
  return out;
}
