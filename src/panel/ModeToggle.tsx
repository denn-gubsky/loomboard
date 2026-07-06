import { ShieldCheck, Zap } from "lucide-react";
import type { ActionMode } from "../state/extMode";

interface Props {
  mode: ActionMode;
  onChange: (m: ActionMode) => void;
}

// Switch between confirm (approve each action) and autonomous (act immediately,
// sensitive fields excepted). Compact segmented control for the panel toolbar.
export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Action mode">
      <button
        className={mode === "confirm" ? "mode-opt active" : "mode-opt"}
        onClick={() => onChange("confirm")}
        title="Approve each browser action before it runs"
      >
        <ShieldCheck size={13} /> Confirm
      </button>
      <button
        className={mode === "autonomous" ? "mode-opt active" : "mode-opt"}
        onClick={() => onChange("autonomous")}
        title="Run actions automatically (sensitive fields still confirm)"
      >
        <Zap size={13} /> Auto
      </button>
    </div>
  );
}
