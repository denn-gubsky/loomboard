// What a hosting server's /runtime-config.js says about the loomcycle to use.
// The loomboard Docker image writes the file from its environment
// (LOOMBOARD_BASE_URL, or its upstream's OAuth issuer); every other build ships
// public/runtime-config.js, which sets nothing.

/** The loomcycle Base URL the hosting server offers, or null. Only a bare
 *  http(s) origin counts: a sign-in's issuer is checked against this address,
 *  so anything else would only make every sign-in fail. The window value is
 *  unvalidated, hence the checks. */
export function readRuntimeBaseUrl(config: unknown): string | null {
  const v = (config as { baseUrl?: unknown } | null | undefined)?.baseUrl;
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) && u.origin === v ? v : null;
  } catch {
    return null;
  }
}
