// Whether the app routes loomcycle calls through a same-origin proxy (calling
// `/v1/*` and naming the target runtime via an `x-loomcycle-target` header) vs
// hitting the loomcycle base URL directly.
//
// True for the dev server (Vite proxy) AND the standalone CLI (which serves this
// build and runs the same proxy) — both dodge loomcycle's lack of CORS. A plain
// production build talks to the base URL directly (needs same-origin/reverse
// proxy or CORS). The standalone build sets VITE_LOOMBOARD_STANDALONE via
// `vite build --mode standalone` (.env.standalone).
export const proxyMode =
  import.meta.env.DEV || import.meta.env.VITE_LOOMBOARD_STANDALONE === "true";
