// Minimal MV3 service worker. Clicking the toolbar action opens the side panel;
// everything stateful (chat, the channel long-poll loop) lives in the side-panel
// document, which persists while open — so the SW's ~30s idle termination never
// drops a run. Keep this stateless.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("[loomboard sw] setPanelBehavior failed", e));

export {};
