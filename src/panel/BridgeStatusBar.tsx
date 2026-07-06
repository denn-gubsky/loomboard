import { useEffect, useState } from "react";
import { bridgeStatus, type BridgeStatus } from "../bridge/status";

// A thin status line under the toolbar showing whether the browser bridge is
// live. Surfaces the loop state + detail (incl. the userId it subscribes under)
// so a broken bridge is visible without devtools.
export default function BridgeStatusBar() {
  const [s, setS] = useState<BridgeStatus>({ state: "off", detail: "" });
  useEffect(() => bridgeStatus.subscribe(setS), []);

  const label =
    s.state === "listening"
      ? "bridge: listening"
      : s.state === "error"
        ? "bridge: error"
        : "bridge: off";

  return (
    <div className={`bridge-status ${s.state}`} title={s.detail}>
      <span className="bridge-dot" />
      <span className="bridge-label">{label}</span>
      {s.detail && <span className="bridge-detail">· {s.detail}</span>}
    </div>
  );
}
