// The Tauri desktop build (vite --mode tauri, .env.tauri). It has no same-origin
// proxy: it calls the loomcycle base URL directly over a native-HTTP fetch
// (routed through Rust) that bypasses the webview's CORS enforcement.
export const isTauri = import.meta.env.VITE_LOOMBOARD_TAURI === "true";

// The Chrome extension build (vite --mode extension, .env.extension). A side-panel
// page fetching a host declared in the manifest's host_permissions bypasses page
// CORS, so — like Tauri — the extension talks to the absolute loomcycle base URL
// directly with a plain fetch + bearer, and must NOT use the dev proxy.
export const isExtension = import.meta.env.VITE_LOOMBOARD_EXTENSION === "true";

// Whether the app routes loomcycle calls through a same-origin proxy (calling
// `/v1/*` and naming the target runtime via an `x-loomcycle-target` header) vs
// hitting the loomcycle base URL directly.
//
// True for the dev server (Vite proxy) AND the standalone CLI (which serves this
// build and runs the same proxy) — both dodge loomcycle's lack of CORS. A plain
// production build talks to the base URL directly (needs same-origin/reverse
// proxy or CORS). The standalone build sets VITE_LOOMBOARD_STANDALONE via
// `vite build --mode standalone` (.env.standalone).
//
// Tauri and the extension are explicitly NOT proxy mode and must win over DEV:
// their dev builds run a Vite dev server (so import.meta.env.DEV is true), but
// each reaches loomcycle directly (native fetch / host_permissions), not the proxy.
export const proxyMode =
  !isTauri &&
  !isExtension &&
  (import.meta.env.DEV || import.meta.env.VITE_LOOMBOARD_STANDALONE === "true");
