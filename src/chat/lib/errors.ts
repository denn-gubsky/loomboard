import { LoomcycleError } from "@loomcycle/client";

/** True for an aborted fetch (stream torn down on conversation switch /
 *  unmount). Callers treat these as expected, not errors to surface. */
export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** Recover the server's human-readable message from a loomcycle JSON error body
 *  (`{code, error, message}`). Some 4xx map to generic SDK error classes whose
 *  `.message` is a stock phrase (e.g. a hard token-budget refusal → 429
 *  BackpressureError "Too Many Requests"; a missing-provider-key refusal → 403),
 *  but the specific message the operator wrote survives in `bodyText`. Pure.
 *  Returns null when the body isn't JSON with a message. */
export function friendlyFromBody(bodyText?: string): string | null {
  if (!bodyText) return null;
  try {
    const b = JSON.parse(bodyText) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof b.message === "string" && b.message.trim()) return b.message;
    if (typeof b.error === "string" && b.error.trim()) return b.error;
    return null;
  } catch {
    return null;
  }
}

/** Map an error to a user-facing message WITHOUT leaking the bearer token or
 *  raw network internals. Prefers the server's JSON body message (e.g. the RFC
 *  AW token-budget banner, the RFC AX missing-provider-key guidance) over the
 *  SDK's generic class message. */
export function describeError(e: unknown): string {
  if (e instanceof LoomcycleError) {
    // The SDK does not put secrets in these; the body message is the operator's
    // intended text (falls back to the SDK message / class name).
    return friendlyFromBody(e.bodyText) ?? e.message ?? e.name;
  }
  if (e instanceof TypeError) {
    // fetch network failures surface as TypeError ("Failed to fetch") — almost
    // always the runtime isn't reachable at that URL, or (production build only)
    // a CORS block.
    return "Could not reach loomcycle. Check the URL and that the runtime is running and reachable from here.";
  }
  if (e instanceof Error) return e.message;
  // Some transports reject with a non-Error: Tauri's plugin-http (native fetch)
  // surfaces failures as a plain string (scope/TLS/connection message), and
  // other layers throw bare objects. Surface those instead of a useless
  // fallback — the message describes the request, never the bearer token.
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "Unknown error";
}
