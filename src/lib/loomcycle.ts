import { LoomcycleClient } from "@loomcycle/client";
import type { ConnectionSettings } from "../state/settings";
import { proxyMode } from "./proxyMode";

// The APP's client singleton, used to validate a connection (whoami) and by the
// sidebar (fork cleanup on delete). The embeddable <Chat> builds its own client
// from the Connection it's given (see chat/lib/createClient) — this one is not
// part of the published component.
let client: LoomcycleClient | null = null;
let signature = "";

export function getClient(s: ConnectionSettings): LoomcycleClient {
  // NUL-join so a token containing the baseUrl (or vice versa) can't collide.
  const sig = `${s.baseUrl} ${s.token}`;
  if (!client || sig !== signature) {
    // In proxy mode (dev server or the standalone CLI) we call same-origin /v1
    // and name the target runtime via a header the proxy routes on — so any
    // reachable loomcycle (local, LAN/TrueNAS, remote) works with no CORS. A
    // plain production build has no proxy, so we hit the Base URL directly
    // (needs CORS or a same-origin reverse proxy).
    const target = s.baseUrl;

    client = new LoomcycleClient({
      baseUrl: proxyMode ? "" : s.baseUrl,
      authToken: s.token || undefined,
      // Wrap fetch for two reasons: (1) the SDK calls its stored fetch as a
      // method (`ctx.fetchImpl(url)`), and the browser's native fetch rejects a
      // non-global receiver with "Illegal invocation"; (2) inject the
      // dynamic-proxy target header in proxy mode.
      fetch: (input, init) => {
        if (proxyMode && target) {
          const headers = new Headers(init?.headers);
          headers.set("x-loomcycle-target", target);
          return fetch(input, { ...init, headers });
        }
        return fetch(input, init);
      },
    });
    signature = sig;
  }
  return client;
}

export function resetClient(): void {
  client = null;
  signature = "";
}
