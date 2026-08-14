import type { WhoamiResponse } from "@loomcycle/client";

// What the connected bearer can actually reach, derived from the whoami
// principal's scopes (RFC BX / RFC L / RFC CB). The tenant plane — the agent
// Library, the History tool, Documents, Memory — is reachable by every
// NON-isolated principal: an operator (`substrate:tenant`), an admin, open/legacy,
// OR a non-isolated member (a runs/channels user token, access_mode "tenant" —
// RFC CB opened the member-accessible tenant routes to it). Only an isolated
// `substrate:user` token (access_mode "isolated") is confined server-side, so the
// UI gates those surfaces on `canTenant` (= not isolated) to stay usable for it.

export interface Capabilities {
  /** Reach tenant-scoped surfaces (Library, Documents, Memory, History): true for
   *  every NON-isolated principal — operator, admin, open/legacy, OR a
   *  non-isolated member (RFC CB). Only an isolated substrate:user is confined. */
  canTenant: boolean;
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
  // RFC CB: the tenant plane (Library / Documents / Memory — browse + author) is
  // reachable by every NON-isolated principal — open_mode/legacy, an admin, a
  // substrate:tenant operator, OR a non-isolated member (a runs:*/channel:* user
  // token, access_mode "tenant"). loomcycle now admits members on the
  // member-accessible tenant routes; only an isolated substrate:user is confined.
  // So canTenant is "authenticated and not isolated".
  const canTenant = Boolean(p) && !isIsolated;
  return { canTenant, isAdmin, isIsolated };
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
