import { useEffect, useState } from "react";
import { bridgeStatus, type BridgeStatus } from "../bridge/status";

// A thin status line under the toolbar showing whether the client-tool
// WebSocket is connected. Surfaces the connection state + detail (the principal
// it runs under, the last tool run) so a broken bridge is visible without devtools.
export default function BridgeStatusBar() {
  const [s, setS] = useState<BridgeStatus>({ state: "off", detail: "" });
  useEffect(() => bridgeStatus.subscribe(setS), []);

  const label =
    s.state === "connected"
      ? "bridge: connected"
      : s.state === "connecting"
        ? "bridge: connecting"
        : s.state === "error"
          ? "bridge: disconnected"
          : "bridge: off";

  return (
    <div className={`bridge-status ${s.state}`} title={s.detail}>
      <span className="bridge-dot" />
      <span className="bridge-label">{label}</span>
      {s.detail && <span className="bridge-detail">· {s.detail}</span>}
    </div>
  );
}
