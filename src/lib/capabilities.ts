import type { WhoamiResponse } from "@loomcycle/client";

// What the connected bearer can actually reach, derived from the whoami
// principal's scopes (RFC BX / RFC L). loomboard is otherwise a tenant-operator
// app: the agent library, the History tool, and the Library view all require
// `substrate:tenant`. A delegated per-user token (RFC BX) has only runs/channels
// (access_mode "tenant") or `substrate:user` (access_mode "isolated"), so those
// surfaces 403 — the UI gates on `canTenant` to stay usable with a user token.

export interface Capabilities {
  /** Reach tenant-scoped surfaces: /v1/_library/* (agent picker, Library view)
   *  and /v1/_history (chat list, rename, archive, recap, search). */
  canTenant: boolean;
  /** Full admin — all tenants. */
  isAdmin: boolean;
  /** A substrate:user token, confined to its own user scope server-side. */
  isIsolated: boolean;
}

export function deriveCapabilities(p: WhoamiResponse | null): Capabilities {
  const scopes = p?.scopes ?? [];
  const isAdmin = Boolean(p?.is_admin);
  // open_mode (single shared token) and legacy (pre-RFC-L secret) are unrestricted.
  const canTenant =
    Boolean(p?.open_mode) ||
    Boolean(p?.legacy) ||
    isAdmin ||
    scopes.includes("substrate:tenant");
  const isIsolated = !canTenant && scopes.includes("substrate:user");
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
