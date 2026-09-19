import type { CompactRunResult } from "@loomcycle/client";
import { formatCount } from "./metrics";

// What to tell the user when a compaction did not compact.
//
// The button used to print one blanket string — "nothing to compact" — for every
// unsuccessful outcome. The server means something much narrower: the message
// list it rebuilt was too short to be worth summarizing. The user, looking at a
// window that is 92% full, reads it as "you're fine". Those are opposite
// meanings, and the gap is how a conversation ran to the top of its window with
// the one control that could have helped reporting success at doing nothing.
//
// `applied` carries the distinction and was previously discarded. Newer runtimes
// refine it further (`noop_keep_spans_all`, `noop_not_smaller` — see the RFC at
// /loomcycle/rfcs/context-distillation-visibility); it is typed as an open
// string here so an older client renders a new reason as prose rather than
// falling back to the blanket line.
//
// Pure → unit-tested.

export function describeCompactResult(r: CompactRunResult): string {
  if (r.compacted) {
    return `Compacted: ${formatCount(r.before_tokens)} → ${formatCount(r.after_tokens)} tokens`;
  }
  const size = r.before_tokens > 0 ? ` (${formatCount(r.before_tokens)} tokens)` : "";
  switch (r.applied as string) {
    case "noop_keep_spans_all":
      // The kept tail covers the whole rebuilt list, so there is no middle span
      // to summarize. Lowering keep_last_n is the operator's lever.
      return `nothing to summarize${size} — the kept tail spans the whole conversation`;
    case "noop_not_smaller":
      return "declined — the summary came out no smaller than what it replaced";
    case "noop":
      // Deliberately not "nothing to compact": this run is short, which says
      // nothing about the session the model is actually being fed.
      return `this run is too short to compact${size}`;
    default:
      return `not compacted (${r.applied})`;
  }
}
