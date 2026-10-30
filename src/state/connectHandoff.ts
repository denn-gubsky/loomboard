// Cross-origin connect handoff — the pure validation behind the postMessage
// receiver in ConnectionProvider. A first-party page (e.g. a loomcycle landing
// that already holds the user's bearer) may hand it to a HOSTED loomboard so the
// app auto-connects without the user re-pasting into the connection screen. This
// mirrors loomcycle's /ui postMessage login.
//
// The two guards here are the whole security story, so they live in a pure,
// unit-tested function rather than inline in the effect:
//   1. the sender's origin must be in the operator-configured allowlist
//      (connectOrigins in /runtime-config.js) — the login-CSRF guard; and
//   2. the payload must be a well-formed { type:'loomboard.connect', token }.

export interface ConnectHandoff {
  baseUrl: string;
  token: string;
}

/** The origin allowlist from the settings /runtime-config.js puts on window.
 *  The file is read when the page loads rather than built in, so one build (the
 *  Docker image) serves any deployment: its server writes the file from the
 *  environment, and every other build ships it empty. Anything but an array of
 *  strings ⇒ [] ⇒ the receiver stays disabled, so a page that didn't opt in
 *  accepts nothing. */
export function readConnectOrigins(config: unknown): string[] {
  const origins = (config as { connectOrigins?: unknown } | null | undefined)
    ?.connectOrigins;
  if (!Array.isArray(origins)) return [];
  return origins
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim())
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
