import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PanelApp from "./PanelApp";
import { loadExtSettings } from "../state/extSettings";
import { loadConversation } from "../state/extConversation";
import "../index.css";
import "../chat/styles.css";
import "./panel.css";

// chrome.storage is async, so hydrate settings + the persisted conversation
// before the first render (mirrors the app's boot pattern).
async function boot() {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element not found");
  const [settings, conversation] = await Promise.all([
    loadExtSettings(),
    loadConversation(),
  ]);
  createRoot(rootEl).render(
    <StrictMode>
      <PanelApp initialSettings={settings} initialConversation={conversation} />
    </StrictMode>,
  );
}

void boot();
