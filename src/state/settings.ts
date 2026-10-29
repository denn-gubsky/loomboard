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
  /** Advanced → "Sign-in server address": the issuer the person accepted
   *  when loomcycle's public address differs from the Base URL (a dev proxy,
   *  a LAN alias). Unset = the issuer must be on the Base URL's origin. */
  signInAddress?: string;
}

/** The persisted record of a sign-in: the server, that it was one, and the
 *  sign-in server address the person set, if any. */
export function signInSettings(baseUrl: string, signInAddress?: string): ConnectionSettings {
  const s: ConnectionSettings = { baseUrl, token: "", auth: "oauth" };
  if (signInAddress?.trim()) s.signInAddress = signInAddress.trim();
  return s;
}

/** Read a persisted record, dropping anything malformed. */
export function parseConnectionSettings(v: unknown): ConnectionSettings | null {
  const p = v as Partial<ConnectionSettings> | null;
  if (!p || typeof p.baseUrl !== "string" || typeof p.token !== "string") return null;
  if (p.auth !== "oauth") return { baseUrl: p.baseUrl, token: p.token };
  return signInSettings(p.baseUrl, typeof p.signInAddress === "string" ? p.signInAddress : undefined);
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
