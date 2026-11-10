// The microphone in the Chrome extension (RFC GI D3). Chrome shows no
// permission prompt in a side panel, but the permission belongs to the
// extension's origin, so once it is granted on an extension page in a tab the
// panel records like any page. Before a take, the panel checks the
// permission: granted → record; not asked yet → open that page in a tab and
// skip this take; denied → let getUserMedia refuse, so the chat says the
// microphone was denied.

/** The extension page that asks for the microphone (src/panel/mic.html). */
export const MIC_PAGE = "src/panel/mic.html";

export interface MicPermissionDeps {
  /** The extension origin's microphone permission. */
  query(): Promise<PermissionState>;
  /** Open MIC_PAGE in a tab. */
  openPermissionPage(): void;
}

/** ChatProps.voice.ensureMicrophone for the side panel. */
export async function ensureExtensionMicrophone(d: MicPermissionDeps): Promise<boolean> {
  let state: PermissionState;
  try {
    state = await d.query();
  } catch {
    // A Chrome that cannot answer: the page asks, and it can prompt.
    state = "prompt";
  }
  if (state === "prompt") {
    d.openPermissionPage();
    return false;
  }
  return true;
}

/** The side panel's deps, over the browser and chrome.* APIs. */
export function chromeMicPermission(): MicPermissionDeps {
  return {
    query: async () => (await navigator.permissions.query({ name: "microphone" as PermissionName })).state,
    openPermissionPage: () => void chrome.tabs.create({ url: chrome.runtime.getURL(MIC_PAGE) }),
  };
}
