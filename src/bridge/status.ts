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

/** Why the browser tools cannot run on this server, or null when they can.
 *  Under `auth.mode: strict` loomcycle reads no bearer from the WebSocket
 *  subprotocol (RFC FA §4), and a browser cannot send an Authorization header
 *  on a WebSocket, so the client-tool host would only loop on refused
 *  handshakes. Delete once loomcycle offers a WebSocket ticket (G34). Pure. */
export function bridgeBlockedBy(authMode: string | undefined): string | null {
  return authMode === "strict"
    ? "browser tools are off: this loomcycle uses strict sign-in, which needs loomcycle G34"
    : null;
}
