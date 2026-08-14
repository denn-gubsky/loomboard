import { useState } from "react";
import { Minimize2, Loader2 } from "lucide-react";
import type { CompactRunResult } from "@loomcycle/client";
import { describeError } from "../lib/errors";

interface Props {
  /** Only enabled while the run is parked — compactRun 409s mid-turn. */
  enabled: boolean;
  onCompact: () => Promise<CompactRunResult | undefined>;
}

// Summarizes the parked run's context to free tokens. A successful compaction
// posts its before→after result into the transcript and refreshes the context
// gauge; the inline note only covers the no-op and error cases.
export default function CompactButton({ enabled, onCompact }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const r = await onCompact();
      if (r && !r.compacted) setNote("nothing to compact");
    } catch (e) {
      setNote(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compact">
      <button
        className="config-toggle"
        onClick={run}
        disabled={!enabled || busy}
        title={
          enabled
            ? "Summarize the conversation to free context"
            : "Available when the agent is idle"
        }
      >
        {busy ? <Loader2 size={15} className="spin" /> : <Minimize2 size={15} />}
        Compact
      </button>
      {note && <span className="compact-note">{note}</span>}
    </div>
  );
}
