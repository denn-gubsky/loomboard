import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest for the loomboard side-panel assistant. Kept minimal: the toolbar
// action opens the side panel; the panel document holds the chat + channel loop.
//
// host_permissions is EMPTY at install time — we request the user-entered
// loomcycle origin (and page origins for actuation) at runtime via
// chrome.permissions.request against optional_host_permissions. That keeps the
// install prompt narrow and makes the broad-access tradeoff explicit to the user.
export default defineManifest({
  manifest_version: 3,
  name: "loomboard",
  version: "0.1.8",
  description:
    "loomboard — agentic browser assistant: a loomcycle chat in the Chrome side panel.",
  action: { default_title: "loomboard" },
  side_panel: { default_path: "src/panel/index.html" },
  background: { service_worker: "extension/sw.ts", type: "module" },
  // The executor content script reads/actuates the active page. Declared on
  // <all_urls> so the assistant can work on any site (this is the "read/change
  // data on all sites" install prompt — appropriate for a browser assistant).
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["extension/content/executor.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["sidePanel", "storage", "scripting", "activeTab", "tabs"],
  host_permissions: [],
  // optional_host_permissions is a valid MV3 key but is missing from @crxjs's
  // ManifestV3 type; spread it via an opaque `object` so it lands at runtime
  // without tripping excess-property checks.
  ...({
    optional_host_permissions: ["http://*/*", "https://*/*"],
  } as object),
});
