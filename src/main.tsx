import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTauri } from "./lib/proxyMode";
import "./index.css";
import "./chat/styles.css";
import "@loomcycle/library/styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

// In the Tauri desktop build, resolve the native-HTTP fetch before rendering so
// the first connection already has it. Both imports sit behind the compile-time
// `isTauri` guard, so they're dropped from the browser/CLI/library builds.
async function boot() {
  if (isTauri) {
    const { initNativeTransport } = await import("./lib/nativeTransport");
    await initNativeTransport();
  }
  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
