import { LoomcycleError } from "@loomcycle/client";

/** True for an aborted fetch (stream torn down on conversation switch /
 *  unmount). Callers treat these as expected, not errors to surface. */
export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** Map an error to a user-facing message WITHOUT leaking the bearer token or
 *  raw network internals. Typed loomcycle errors carry a safe `.message`. */
export function describeError(e: unknown): string {
  if (e instanceof LoomcycleError) {
    // e.g. AuthError -> "unauthorized (401)". The SDK does not put secrets in
    // these messages.
    return e.message || e.name;
  }
  if (e instanceof TypeError) {
    // fetch network failures surface as TypeError ("Failed to fetch") — almost
    // always the runtime isn't reachable at that URL, or (production build only)
    // a CORS block.
    return "Could not reach loomcycle. Check the URL and that the runtime is running and reachable from here.";
  }
  if (e instanceof Error) return e.message;
  return "Unknown error";
}
