// Connection settings for the extension, backed by chrome.storage.local. Mirrors
// src/state/settings.ts (localStorage) but async — the token/baseUrl live in the
// extension's local storage so the side panel re-attaches across opens.
//
// SECURITY: `token` is a secret (CLAUDE.md). It lives here only; never log it,
// never serialize it into a channel payload, screenshot, or telemetry.

// A sign-in stores only {baseUrl, auth: "oauth"} here; its refresh token lives
// in chrome.storage.session (state/signInStore), never in local storage.

import { parseConnectionSettings, type ConnectionSettings } from "./settings";
import { storageGet, storageRemove, storageSet } from "./chromeStorage";

const KEY = "loomboard.connection";

export async function loadExtSettings(): Promise<ConnectionSettings | null> {
  return parseConnectionSettings(await storageGet<unknown>(KEY));
}

export async function saveExtSettings(s: ConnectionSettings): Promise<void> {
  await storageSet(KEY, s);
}

export async function clearExtSettings(): Promise<void> {
  await storageRemove(KEY);
}
