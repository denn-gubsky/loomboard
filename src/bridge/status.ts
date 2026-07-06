// Tiny observable for the browser-bridge state, so the panel can show whether
// the channel loop is actually running (and which userId it subscribes under)
// without opening devtools. The non-React channel loop + PanelApp write to it;
// BridgeStatusBar subscribes.

export type BridgeState = "off" | "listening" | "error";

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
