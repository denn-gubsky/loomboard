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
  /** Bearer token. Empty is valid when loomcycle runs in open mode. */
  token: string;
}

const KEY = "loomboard.connection";

export function loadSettings(): ConnectionSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") {
      return null;
    }
    return { baseUrl: parsed.baseUrl, token: parsed.token };
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
