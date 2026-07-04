import { LoomcycleClient } from "@loomcycle/client";

// Connection the host hands to <Chat>. `fetch` is an optional override so an
// embedding app can route requests however it needs (e.g. loomboard's dev proxy
// injects an `x-loomcycle-target` header). External consumers just pass
// baseUrl + token and hit the runtime directly.
export interface Connection {
  /** loomcycle base URL. "" means same-origin. */
  baseUrl: string;
  /** Bearer token. Omit when the runtime runs in open mode. */
  token?: string;
  /** Optional fetch override (proxying, header injection, instrumentation). */
  fetch?: typeof fetch;
}

/** Build a loomcycle client from a Connection. The fetch is always wrapped: the
 *  SDK calls its stored fetch as a method (`ctx.fetchImpl(url)`), and the
 *  browser's native fetch rejects a non-global receiver with "Illegal
 *  invocation" — so we hand it a plain function bound to `window`. */
export function createLoomcycleClient(c: Connection): LoomcycleClient {
  const impl = c.fetch;
  return new LoomcycleClient({
    baseUrl: c.baseUrl,
    authToken: c.token || undefined,
    fetch: (input, init) => (impl ? impl(input, init) : fetch(input, init)),
  });
}
