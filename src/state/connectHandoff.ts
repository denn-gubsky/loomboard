// Cross-origin connect handoff — the pure validation behind the postMessage
// receiver in ConnectionProvider. A first-party page (e.g. a loomcycle landing
// that already holds the user's bearer) may hand it to a HOSTED loomboard so the
// app auto-connects without the user re-pasting into the connection screen. This
// mirrors loomcycle's /ui postMessage login.
//
// The two guards here are the whole security story, so they live in a pure,
// unit-tested function rather than inline in the effect:
//   1. the sender's origin must be in the operator-configured allowlist
//      (VITE_LOOMBOARD_CONNECT_ORIGINS) — the login-CSRF guard; and
//   2. the payload must be a well-formed { type:'loomboard.connect', token }.

export interface ConnectHandoff {
  baseUrl: string;
  token: string;
}

/** Parse the comma-separated origin allowlist. Empty / unset ⇒ [] ⇒ the
 *  receiver stays disabled, so a build that didn't opt in accepts nothing. */
export function parseConnectOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Validate a postMessage connect handoff against the allowlist. Returns the
 *  { baseUrl, token } to connect with, or null when the origin isn't allowlisted
 *  or the payload is malformed. A missing baseUrl defaults to "" (same-origin —
 *  the app rides the hosting reverse proxy to reach /v1). */
export function parseConnectMessage(
  allowed: string[],
  origin: string,
  data: unknown,
): ConnectHandoff | null {
  if (allowed.length === 0 || !allowed.includes(origin)) return null;
  const d = data as { type?: unknown; baseUrl?: unknown; token?: unknown } | null;
  if (!d || d.type !== "loomboard.connect" || typeof d.token !== "string") {
    return null;
  }
  const baseUrl = typeof d.baseUrl === "string" ? d.baseUrl : "";
  return { baseUrl, token: d.token };
}
