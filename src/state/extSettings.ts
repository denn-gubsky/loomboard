// Connection settings for the extension, backed by chrome.storage.local. Mirrors
// src/state/settings.ts (localStorage) but async — the token/baseUrl live in the
// extension's local storage so the side panel re-attaches across opens.
//
// SECURITY: `token` is a secret (CLAUDE.md). It lives here only; never log it,
// never serialize it into a channel payload, screenshot, or telemetry.

import type { ConnectionSettings } from "./settings";
import { storageGet, storageRemove, storageSet } from "./chromeStorage";

const KEY = "loomboard.connection";

export async function loadExtSettings(): Promise<ConnectionSettings | null> {
  const parsed = await storageGet<Partial<ConnectionSettings>>(KEY);
  if (
    !parsed ||
    typeof parsed.baseUrl !== "string" ||
    typeof parsed.token !== "string"
  ) {
    return null;
  }
  return { baseUrl: parsed.baseUrl, token: parsed.token };
}

export async function saveExtSettings(s: ConnectionSettings): Promise<void> {
  await storageSet(KEY, s);
}

export async function clearExtSettings(): Promise<void> {
  await storageRemove(KEY);
}
