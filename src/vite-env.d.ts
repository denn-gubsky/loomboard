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
}
