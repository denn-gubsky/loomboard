// Native HTTP transport for the Tauri desktop build. Routes fetch through Rust
// (@tauri-apps/plugin-http) so requests bypass the webview's CORS enforcement:
// loomcycle sends no CORS headers, and unlike the browser/CLI builds the desktop
// app has NO same-origin proxy. Only ever reached behind the isTauri branch
// (see proxyMode.ts), and only via the dynamic import below — so @tauri-apps/*
// is tree-shaken out of the browser, CLI, and published-library bundles.

let nativeFetch: typeof fetch | null = null;

// Resolve the plugin fetch once at startup. The dynamic import is what keeps
// @tauri-apps/* out of the other bundles; call (and await) this before render.
export async function initNativeTransport(): Promise<void> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  // Wrap as a plain function: the SDK stores fetch and calls it as a method
  // (ctx.fetchImpl(url)); a plain fn avoids "Illegal invocation", same reason
  // the browser path wraps window.fetch (see chat/lib/createClient).
  nativeFetch = (input, init) =>
    tauriFetch(input as Parameters<typeof tauriFetch>[0], init);
}

// Stable singleton for the whole app lifetime. <Chat> memoizes its client on
// connection.fetch, so returning the SAME reference every call prevents churn
// (a new closure would rebuild the client and tear down an in-flight stream).
export function getNativeFetch(): typeof fetch {
  if (!nativeFetch) throw new Error("native transport not initialized");
  return nativeFetch;
}
