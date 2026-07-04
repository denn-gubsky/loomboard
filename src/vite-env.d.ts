/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in the standalone CLI build (vite --mode standalone): route
   *  loomcycle calls through a same-origin proxy, like the dev server. */
  readonly VITE_LOOMBOARD_STANDALONE?: string;
}
