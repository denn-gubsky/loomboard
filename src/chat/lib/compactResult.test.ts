import { describe, expect, it } from "vitest";
import type { CompactRunResult } from "@loomcycle/client";
import { describeCompactResult } from "./compactResult";

const r = (o: Partial<CompactRunResult>): CompactRunResult => ({
  run_id: "r1",
  compacted: false,
  before_tokens: 0,
  after_tokens: 0,
  applied: "noop",
  ...o,
});

describe("describeCompactResult", () => {
  it("reports a successful compaction with both numbers", () => {
    expect(
      describeCompactResult(r({ compacted: true, applied: "live", before_tokens: 18299, after_tokens: 11676 })),
    ).toBe("Compacted: 18k → 12k tokens");
  });

  // THE ONE THAT MATTERS. The server means "the list I rebuilt was too short";
  // the user, looking at a window that is 92% full, read "nothing to compact" as
  // "you're fine". Those are opposite meanings.
  it("says the RUN is short, not that the conversation is fine", () => {
    const note = describeCompactResult(r({ applied: "noop", before_tokens: 900 }));
    expect(note).toContain("this run is too short");
    expect(note).toContain("900 tokens");
    expect(note).not.toContain("nothing to compact");
  });

  it("names the kept tail when it spans everything", () => {
    expect(describeCompactResult(r({ applied: "noop_keep_spans_all" as CompactRunResult["applied"], before_tokens: 30000 })))
      .toBe("nothing to summarize (30k tokens) — the kept tail spans the whole conversation");
  });

  it("names a summary that came out no smaller", () => {
    expect(describeCompactResult(r({ applied: "noop_not_smaller" as CompactRunResult["applied"] })))
      .toContain("no smaller");
  });

  // An older client must not fall back to the blanket line when a newer runtime
  // sends a reason it has not heard of.
  it("passes an unknown reason through rather than swallowing it", () => {
    expect(describeCompactResult(r({ applied: "noop_something_new" as CompactRunResult["applied"] })))
      .toBe("not compacted (noop_something_new)");
  });

  it("omits a size it does not have", () => {
    expect(describeCompactResult(r({ applied: "noop", before_tokens: 0 })))
      .toBe("this run is too short to compact");
  });
});
