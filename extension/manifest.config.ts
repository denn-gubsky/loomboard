import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest for the loomboard side-panel assistant. Kept minimal: the toolbar
// action opens the side panel; the panel document holds the chat + channel loop.
//
// host_permissions is EMPTY at install time: cross-origin fetch access to the
// user-entered loomcycle origin (and page origins for actuation) is granted at
// runtime via chrome.permissions.request against optional_host_permissions.
// This does NOT narrow the install prompt, though — the content_scripts entry
// below is statically declared on <all_urls>, so Chrome still shows the broad
// "read and change all your data on all websites" prompt at install time (see
// the content_scripts note and README "Security & trust model").
export default defineManifest({
  manifest_version: 3,
  name: "loomboard",
  version: "0.1.11",
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
