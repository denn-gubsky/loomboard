// Tiny observable for the browser-bridge state, so the panel can show whether
// the client-tool WebSocket is connected (and what it last ran) without opening
// devtools. The non-React client-tool host + PanelApp write to it;
// BridgeStatusBar subscribes.

export type BridgeState = "off" | "connecting" | "connected" | "error";

export interface BridgeStatus {
  state: BridgeState;
  detail: string;
}

type Listener = (s: BridgeStatus) => void;

class BridgeStatusStore {
  private current: BridgeStatus = { state: "off", detail: "" };
  private readonly listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.current);
    return () => {
      this.listeners.delete(l);
    };
  }

  set(state: BridgeState, detail = ""): void {
    this.current = { state, detail };
    for (const l of this.listeners) l(this.current);
  }
}

export const bridgeStatus = new BridgeStatusStore();
