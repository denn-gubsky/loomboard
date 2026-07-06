import { useEffect, useState } from "react";
import { Check, X, ShieldAlert } from "lucide-react";
import { approval, type PendingAction } from "../bridge/approval";
import type { BrowserCommand } from "../bridge/protocol";

// Renders the pending browser action awaiting the user's approval (confirm mode).
// Driven by the channel loop via the approval mediator.
export default function ActionBar() {
  const [pending, setPending] = useState<PendingAction | null>(null);
  useEffect(() => approval.subscribe(setPending), []);

  if (!pending) return null;
  const { cmd } = pending;

  return (
    <div className="action-bar" role="alertdialog" aria-label="Approve browser action">
      <div className="action-desc">
        <ShieldAlert size={15} />
        <div className="action-text">
          <strong>{actionLabel(cmd)}</strong>
          {cmd.reason && <span className="action-reason">{cmd.reason}</span>}
        </div>
      </div>
      <div className="action-btns">
        <button className="action-approve" onClick={pending.approve}>
          <Check size={14} /> Approve
        </button>
        <button className="action-reject" onClick={pending.reject}>
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  );
}

function actionLabel(cmd: BrowserCommand): string {
  switch (cmd.op) {
    case "fill":
      return `Fill a field with “${(cmd.value ?? "").slice(0, 60)}”`;
    case "click":
      return "Click an element";
    case "navigate":
      return `Navigate to ${cmd.url ?? "?"}`;
    default:
      return cmd.op;
  }
}
