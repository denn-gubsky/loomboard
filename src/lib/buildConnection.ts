import type { Connection } from "../chat/lib/createClient";
import type { ConnectionSettings as ConnSettings } from "../state/settings";
import { isTauri, proxyMode } from "./proxyMode";
import { getNativeFetch } from "./nativeTransport";

/** How the app reaches a loomcycle: the address to call and the fetch to call
 *  it with. `fetch` undefined = the browser's own. */
export interface Transport {
  baseUrl: string;
  fetch?: typeof fetch;
}

// The transport for a base URL. The transport detail (native HTTP on desktop,
// the dev proxy in the browser, or a direct URL) is the APP's concern — every
// client the app builds goes through here, so they all reach loomcycle the
// same way.
export function transportFor(baseUrl: string): Transport {
  if (isTauri) {
    // Desktop: hit the absolute loomcycle URL directly via native HTTP (Rust),
    // which bypasses webview CORS. getNativeFetch() is a stable singleton so
    // <Chat>'s client memo (keyed on connection.fetch) doesn't churn. Blank URL
    // → the same local default the CLI uses.
    return { baseUrl: baseUrl || "http://127.0.0.1:8787", fetch: getNativeFetch() };
  }
  if (proxyMode) {
    // Same-origin /v1 through the dev/CLI proxy, which routes on this header.
    const target = baseUrl;
    return {
      baseUrl: "",
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (target) headers.set("x-loomcycle-target", target);
        return fetch(input, { ...init, headers });
      },
    };
  }
  return { baseUrl };
}

// Build the <Chat>-facing Connection from the persisted settings. Shared so
// every surface that embeds <Chat> (the chat pane, the agent portfolio, the
// workflow chat dock) builds it identically.
export function buildConnection(s: ConnSettings): Connection {
  return { ...transportFor(s.baseUrl), token: s.token };
}
