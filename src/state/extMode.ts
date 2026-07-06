// The action mode for browser actuation, persisted in chrome.storage.local.
// "confirm" (default): every mutating action waits for the user's approval.
// "autonomous": actions run immediately (except sensitive fields, which always
// confirm), with a Stop to halt.

import { storageGet, storageSet } from "./chromeStorage";

export type ActionMode = "confirm" | "autonomous";

const KEY = "loomboard.actionMode";

export async function loadMode(): Promise<ActionMode> {
  const m = await storageGet<ActionMode>(KEY);
  return m === "autonomous" ? "autonomous" : "confirm";
}

export async function saveMode(m: ActionMode): Promise<void> {
  await storageSet(KEY, m);
}
