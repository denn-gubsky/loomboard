import type { PendingSignIn, RefreshTokenStore, StoredSignIn } from "../lib/appSignIn";

// Where each form factor keeps a sign-in between starts. Only the refresh
// token is ever stored — the access token lives in memory — and never in
// localStorage (CLAUDE.md rule 4: a token in localStorage outlives the tab and
// is readable by every page script for as long as the origin is). Per form
// factor:
//
// - web: sessionStorage. Scoped to the tab and gone when it closes; survives a
//   reload, so a reload refreshes silently instead of bouncing through the
//   sign-in page. One tab, one sign-in — which is also what the SDK asks for,
//   since two holders refreshing the same token end the sign-in.
// - extension: chrome.storage.session — memory-only, cleared when the browser
//   quits, and not readable from content scripts (trusted contexts only).
// - desktop: the OS keychain, through the app's own keychain commands.
//
// A stored value names the server it belongs to; one for another Base URL is
// never returned (and so never sent there).

const REFRESH_KEY = "loomboard.signin";
const PENDING_KEY = "loomboard.signin.pending";

/** The three operations a key/value backend offers. */
export interface KeyValue {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

function parseStored(raw: string | null): StoredSignIn | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSignIn>;
    if (typeof v.baseUrl !== "string" || typeof v.refreshToken !== "string" || !v.refreshToken) return null;
    return { baseUrl: v.baseUrl, refreshToken: v.refreshToken };
  } catch {
    return null;
  }
}

/** A RefreshTokenStore over any key/value backend. */
export function refreshStoreOver(kv: KeyValue): RefreshTokenStore {
  return {
    async load(baseUrl) {
      const s = parseStored(await kv.get());
      return s && s.baseUrl === baseUrl ? s.refreshToken : null;
    },
    save: (s) => kv.set(JSON.stringify({ baseUrl: s.baseUrl, refreshToken: s.refreshToken })),
    clear: () => kv.remove(),
  };
}

/** web: the tab's sessionStorage. */
export function webRefreshStore(storage: Storage = sessionStorage): RefreshTokenStore {
  return refreshStoreOver({
    get: async () => storage.getItem(REFRESH_KEY),
    set: async (v) => storage.setItem(REFRESH_KEY, v),
    remove: async () => storage.removeItem(REFRESH_KEY),
  });
}

/** Chrome extension: chrome.storage.session (pass it; tests pass a fake). */
export function chromeSessionRefreshStore(area: chrome.storage.StorageArea): RefreshTokenStore {
  return refreshStoreOver({
    get: async () => {
      const out = await area.get(REFRESH_KEY);
      const v = out[REFRESH_KEY];
      return typeof v === "string" ? v : null;
    },
    set: (v) => area.set({ [REFRESH_KEY]: v }),
    remove: () => area.remove(REFRESH_KEY),
  });
}

/** The Tauri commands that hold the sign-in in the OS keychain (src-tauri).
 *  They read and write one fixed entry, so the webview can reach nothing else
 *  in the keychain. */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Desktop: the OS keychain. */
export function keychainRefreshStore(invoke: Invoke): RefreshTokenStore {
  return refreshStoreOver({
    get: () => invoke<string | null>("sign_in_secret_get"),
    set: (value) => invoke<void>("sign_in_secret_set", { value }),
    remove: () => invoke<void>("sign_in_secret_delete"),
  });
}

/** web: keep a sign-in in progress for the redirect round trip. */
export function savePendingSignIn(storage: Storage, p: PendingSignIn): void {
  storage.setItem(PENDING_KEY, JSON.stringify(p));
}

/** web: the sign-in in progress, removed as it is read — a reload of the
 *  callback page, or a second callback, finds nothing to complete. */
export function takePendingSignIn(storage: Storage): PendingSignIn | null {
  const raw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingSignIn>;
    const fields = [p.baseUrl, p.issuer, p.redirectUri, p.state, p.verifier];
    if (fields.some((f) => typeof f !== "string")) return null;
    return p as PendingSignIn;
  } catch {
    return null;
  }
}
