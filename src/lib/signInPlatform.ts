import type { RefreshTokenStore } from "./appSignIn";
import { isTauri } from "./proxyMode";
import { keychainRefreshStore, webRefreshStore, type Invoke } from "../state/signInStore";

// The app's (web + desktop) platform seams for sign-in. The Tauri API is a
// dynamic import inside a positive `if (isTauri)` block — the shape the bundler
// can drop from the browser, CLI and library builds (same as main.tsx's
// nativeTransport). The extension has its own (src/panel).

export async function tauriInvoke(): Promise<Invoke> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  throw new Error("the Tauri API exists only in the desktop app");
}

/** Where this build keeps the refresh token: the OS keychain on desktop, the
 *  tab's sessionStorage on the web. */
export async function platformRefreshStore(): Promise<RefreshTokenStore> {
  return isTauri ? keychainRefreshStore(await tauriInvoke()) : webRefreshStore();
}
