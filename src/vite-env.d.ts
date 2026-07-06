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
}
