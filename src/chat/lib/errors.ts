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
    const refusal = describeAccessRefusal(e);
    if (refusal) return refusal;
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

interface DenyReason {
  acl: string;
  version?: number;
  rule: number;
  effect: string;
}

/** An access-rule refusal (loomcycle 1.122+, RFC EY/EZ), worded the way
 *  loomcycle's Web UI words it; null for any other error. Pure.
 *
 *  Matched on the body's `code`, not `instanceof AclDeniedError`: that class
 *  is in @loomcycle/client 1.122+, and this package's peer range starts at
 *  1.84, where importing it would not link. The fields come from the error
 *  when the client parsed them, else from the body. */
export function describeAccessRefusal(e: LoomcycleError): string | null {
  const body = parseBody(e.bodyText);
  const code = e.code ?? str(body?.code);
  if (code === "acl_denied") {
    const d = e as LoomcycleError & { action?: string | null; resource?: string | null; reasons?: unknown };
    const action = d.action ?? str(body?.action) ?? "?";
    const resource = d.resource ?? str(body?.resource) ?? "?";
    const denies = reasonsOf(d.reasons ?? body?.reasons).filter((r) => r.effect === "deny");
    const head = `Access denied: you may not ${action} ${resource}`;
    if (denies.length === 0) return `${head} — no access rule allows it.`;
    const rules = denies
      .map((r) => `list "${r.acl}"${r.version !== undefined ? ` v${r.version}` : ""} rule ${r.rule}`)
      .join("; ");
    return `${head} — denied by ${rules}.`;
  }
  if (code === "acl_unavailable") {
    return "Access rules could not be read right now — try again in a moment.";
  }
  if (code === "acl_self_elevation") {
    const why = (str(body?.error) ?? "the change would widen your own access").replace(/^refused:\s*/, "");
    return `Refused — ${why}`;
  }
  return null;
}

function parseBody(bodyText?: string): Record<string, unknown> | null {
  if (!bodyText) return null;
  try {
    const b: unknown = JSON.parse(bodyText);
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function reasonsOf(v: unknown): DenyReason[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r): DenyReason[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.acl !== "string" || typeof o.rule !== "number" || typeof o.effect !== "string") return [];
    return [{ acl: o.acl, rule: o.rule, effect: o.effect, ...(typeof o.version === "number" ? { version: o.version } : {}) }];
  });
}
