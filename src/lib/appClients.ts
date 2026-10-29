import type { AppClientConfig, AppClientEntry } from "@loomcycle/client";

// The Apps view's logic, kept pure: reading the app clients loomcycle signs
// people in for (RFC FL: `auth.clients` in its config, and ClientDefs
// registered at runtime), and building the definitions the view registers.

/** The redirect URI and origin a loomboard build signs in from. */
export interface ThisApp {
  redirectUri: string;
  origin: string;
}

/** A client as the view lists it. */
export interface AppRow {
  name: string;
  label: string;
  /** Whose people it signs in. */
  serves: string;
  redirectUris: string[];
  origins: string[];
  /** A runtime ClientDef: one this view may change or retire (the server
   *  still decides). A config client is read-only through the API. */
  editable: boolean;
  version?: number;
}

export function appRow(e: AppClientEntry): AppRow {
  const def = e.source === "def";
  return {
    name: e.name,
    label: e.label,
    serves: e.all_tenants ? "every tenant" : `tenant ${e.tenant_id || "default"}`,
    redirectUris: e.redirect_uris,
    origins: (def ? e.client.allowed_origins : e.allowed_origins) ?? [],
    editable: def,
    version: def ? e.version : undefined,
  };
}

/** One entry per non-blank line, trimmed, first occurrence kept. */
export function parseLines(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];
}

/** A new public client: loomcycle has no other kind (the app holds no secret;
 *  PKCE binds each code to it). */
export function newClient(label: string, redirectUris: string[], origins: string[]): AppClientConfig {
  return {
    kind: "public",
    ...(label.trim() ? { label: label.trim() } : {}),
    redirect_uris: redirectUris,
    ...(origins.length ? { allowed_origins: origins } : {}),
  };
}

/** Whether a client already lets this loomboard sign in. */
export function admitsThisApp(row: AppRow, app: ThisApp): boolean {
  return row.redirectUris.includes(app.redirectUri) && row.origins.includes(app.origin);
}

/** The client's definition with this loomboard's redirect URI and origin
 *  added — an update is a whole new version, so everything else is kept. */
export function withThisApp(client: AppClientConfig, app: ThisApp): AppClientConfig {
  const add = (list: string[] | undefined, v: string) => (list?.includes(v) ? list : [...(list ?? []), v]);
  return {
    ...client,
    redirect_uris: add(client.redirect_uris, app.redirectUri),
    allowed_origins: add(client.allowed_origins, app.origin),
  };
}
