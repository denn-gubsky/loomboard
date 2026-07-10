import type { CSSProperties } from "react";
import { AlertTriangle, HelpCircle, type LucideIcon } from "lucide-react";
import type { TileDisplayState } from "../../lib/runStates";
import type { PreviewLine } from "../../lib/tilePreview";
import AgentChatPreview from "./AgentChatPreview";

// The compact agent-chat view — the parameterized tile object. Purely
// presentational: identity params (agentName / Icon / accentColor) + the derived
// data (state, preview, alert, question) come in as props, so it's reusable on a
// board or an RFC AC card and trivially testable. Click → onOpen (enlarge).

export interface AgentChatTileProps {
  agentName: string;
  Icon: LucideIcon;
  accentColor: string;
  state: TileDisplayState;
  preview: PreviewLine[];
  loadingPreview?: boolean;
  /** Alert text (e.g. run error / hard token-budget) → ⚠ badge. */
  alert?: string;
  /** Pending agent question text → ❓ badge (the thing that must pop). */
  question?: string;
  questionPriority?: string;
  onOpen: () => void;
}

const STATE_LABEL: Record<TileDisplayState, string> = {
  running: "running",
  needs_input: "needs input",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export default function AgentChatTile({
  agentName,
  Icon,
  accentColor,
  state,
  preview,
  loadingPreview,
  alert,
  question,
  questionPriority,
  onOpen,
}: AgentChatTileProps) {
  // The accent tints the avatar + a subtle card wash + the left rail, all from
  // one custom property so a color override recolors the whole tile.
  const style = { "--tile-accent": accentColor } as CSSProperties;

  // A clickable card (role=button, not <button>, so it can hold block content).
  return (
    <div
      className={`agentchat-tile state-${state}`}
      style={style}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title={`${agentName} — ${STATE_LABEL[state]}`}
    >
      <div className="act-head">
        <span className="act-avatar" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="act-name">{agentName}</span>
        <span className={`act-dot dot-${state}`} aria-hidden />
      </div>

      <AgentChatPreview
        lines={preview}
        placeholder={loadingPreview ? "loading…" : STATE_LABEL[state]}
      />

      {(question || alert) && (
        <div className="act-badges">
          {question && (
            <span
              className={`act-badge badge-question prio-${questionPriority ?? "normal"}`}
              title={question}
            >
              <HelpCircle size={12} /> needs answer
            </span>
          )}
          {alert && (
            <span className="act-badge badge-alert" title={alert}>
              <AlertTriangle size={12} /> error
            </span>
          )}
        </div>
      )}
    </div>
  );
}
