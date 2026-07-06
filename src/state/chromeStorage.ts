// Promise-wrapped chrome.storage.local adapter for the Chrome extension build.
// The web app uses synchronous localStorage; the extension can only use the async
// chrome.storage.local (shared across the side panel, service worker, and content
// script). Callers hydrate what they need in an async boot() before rendering.
//
// SECURITY: the bearer token is stored here (key loomboard.connection). Same rule
// as localStorage — never log a value read from here, never place it in a channel
// payload, screenshot, or telemetry (CLAUDE.md security rules).

export async function storageGet<T>(key: string): Promise<T | null> {
  const out = await chrome.storage.local.get(key);
  return (out[key] as T | undefined) ?? null;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function storageRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/** Subscribe to changes for a single key in the local area. Returns an
 *  unsubscribe fn. Used so the panel and service worker stay in sync (e.g. a
 *  token cleared in one context logs the other out). */
export function storageSubscribe<T>(
  key: string,
  onChange: (value: T | null) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !(key in changes)) return;
    onChange((changes[key].newValue as T | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
