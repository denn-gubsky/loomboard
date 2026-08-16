import type { Connection } from "../chat/lib/createClient";
import type { ConnectionSettings as ConnSettings } from "../state/settings";
import { isTauri, proxyMode } from "./proxyMode";
import { getNativeFetch } from "./nativeTransport";

// Build the <Chat>-facing Connection from the persisted settings. The transport
// detail (native HTTP on desktop, the dev proxy in the browser, or a direct URL)
// is the APP's concern — chat components just take a Connection. Shared so every
// surface that embeds <Chat> (the chat pane, the agent portfolio, the workflow
// chat dock) builds it identically.
export function buildConnection(s: ConnSettings): Connection {
  if (isTauri) {
    // Desktop: hit the absolute loomcycle URL directly via native HTTP (Rust),
    // which bypasses webview CORS. getNativeFetch() is a stable singleton so
    // <Chat>'s client memo (keyed on connection.fetch) doesn't churn. Blank URL
    // → the same local default the CLI uses.
    return {
      baseUrl: s.baseUrl || "http://127.0.0.1:8787",
      token: s.token,
      fetch: getNativeFetch(),
    };
  }
  if (proxyMode) {
    const target = s.baseUrl;
    return {
      baseUrl: "",
      token: s.token,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (target) headers.set("x-loomcycle-target", target);
        return fetch(input, { ...init, headers });
      },
    };
  }
  return { baseUrl: s.baseUrl, token: s.token };
}
