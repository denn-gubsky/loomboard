// Connection settings persisted in localStorage. This is the ONLY thing
// loomboard stores client-side besides the conversation index — loomcycle owns
// real persistence. The bearer token is a secret: it lives here so the SPA can
// re-attach across reloads, but it must never be serialized into a screenshot,
// error report, or telemetry payload (see CLAUDE.md security rules).

export interface ConnectionSettings {
  /** loomcycle base URL. Empty string = same-origin (rides the Vite dev proxy
   *  in dev, or a co-hosted deployment in prod). An absolute URL talks to
   *  loomcycle directly and requires CORS to be enabled there. */
  baseUrl: string;
  /** Bearer token. Empty is valid when loomcycle runs in open mode, and is
   *  always empty for a sign-in. */
  token: string;
  /** "oauth" = signed in with loomcycle (RFC FL). The tokens are NOT here: the
   *  access token lives in memory and the refresh token in the form factor's
   *  own store (state/signInStore). Absent = the pasted-token connection. */
  auth?: "oauth";
}

/** The persisted record of a sign-in: the server, and that it was one. */
export function signInSettings(baseUrl: string): ConnectionSettings {
  return { baseUrl, token: "", auth: "oauth" };
}

/** Read a persisted record, dropping anything malformed. */
export function parseConnectionSettings(v: unknown): ConnectionSettings | null {
  const p = v as Partial<ConnectionSettings> | null;
  if (!p || typeof p.baseUrl !== "string" || typeof p.token !== "string") return null;
  if (p.auth !== "oauth") return { baseUrl: p.baseUrl, token: p.token };
  return signInSettings(p.baseUrl);
}

const KEY = "loomboard.connection";

export function loadSettings(): ConnectionSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseConnectionSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSettings(s: ConnectionSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSettings(): void {
  localStorage.removeItem(KEY);
}
