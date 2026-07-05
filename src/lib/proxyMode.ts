// The Tauri desktop build (vite --mode tauri, .env.tauri). It has no same-origin
// proxy: it calls the loomcycle base URL directly over a native-HTTP fetch
// (routed through Rust) that bypasses the webview's CORS enforcement.
export const isTauri = import.meta.env.VITE_LOOMBOARD_TAURI === "true";

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
// Tauri is explicitly NOT proxy mode and must win over DEV: `tauri dev` loads a
// Vite dev server (so import.meta.env.DEV is true), but the desktop app reaches
// loomcycle via the native fetch, not the dev proxy.
export const proxyMode =
  !isTauri &&
  (import.meta.env.DEV || import.meta.env.VITE_LOOMBOARD_STANDALONE === "true");
