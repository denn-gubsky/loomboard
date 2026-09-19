/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in the standalone CLI build (vite --mode standalone): route
   *  loomcycle calls through a same-origin proxy, like the dev server. */
  readonly VITE_LOOMBOARD_STANDALONE?: string;
  /** "true" in the Tauri desktop build (vite --mode tauri): no proxy — call the
   *  loomcycle base URL directly via a native-HTTP fetch that bypasses CORS. */
  readonly VITE_LOOMBOARD_TAURI?: string;
  /** "true" in the Chrome extension build (vite --mode extension): no proxy —
   *  the side panel fetches the loomcycle base URL directly (host_permissions
   *  bypass page CORS). */
  readonly VITE_LOOMBOARD_EXTENSION?: string;
  /** Comma-separated origin allowlist for the cross-origin connect handoff: a
   *  first-party page (e.g. a loomcycle landing that already holds the user's
   *  bearer) may postMessage {baseUrl, token} to auto-connect this app. Empty /
   *  unset ⇒ the receiver is disabled, so a build that doesn't opt in can't be
   *  handed a token by any page. Set only for a HOSTED loomboard behind a trusted
   *  landing — NOT baked into the published CLI/desktop/extension builds. */
  readonly VITE_LOOMBOARD_CONNECT_ORIGINS?: string;
  /** DEV ONLY — bearer to auto-connect with, so `VITE_DEV_TOKEN=… npm run dev`
   *  skips the Connect screen. Read behind `import.meta.env.DEV`, which is the
   *  literal `false` in any `vite build`, so neither the branch nor the inlined
   *  token survives into a shipped bundle (see lib/devConnect). */
  readonly VITE_DEV_TOKEN?: string;
  /** DEV ONLY — the runtime VITE_DEV_TOKEN points at, e.g.
   *  http://192.168.0.77:8787. Blank/unset ⇒ the dev proxy's own default target
   *  (LOOMBOARD_PROXY_TARGET, else http://127.0.0.1:8787). */
  readonly VITE_DEV_BASE_URL?: string;
}
