import { describe, expect, it } from "vitest";
import { parseJsonPath } from "./jsonpath";

// WHY this exists alongside the shared fixtures: those assert a VERDICT
// (saveable / blocked), and several of this parser's rules do not change the
// verdict — only the message. `$..title` is rejected either way, because after
// the leading dot the recursive-descent form also reads as an empty key
// segment. Deleting the explicit `..` check therefore passes every fixture
// while silently degrading the error an operator reads.
//
// That was found by mutation rather than by review: breaking each new rule in
// turn and checking the suite went red. This file is what makes the four
// message-level rules fail loudly.

describe("parseJsonPath — accepts the strict subset", () => {
  it.each(["$", "$.a", "$.a.b.c", "$[0]", "$.items[3].name", "$.a[0][1]", "  $.a  "])(
    "accepts %s",
    (path) => {
      expect(parseJsonPath(path)).toBeNull();
    },
  );
});

describe("parseJsonPath — rejects everything outside it", () => {
  // Each message is asserted verbatim, not merely "is non-null". The whole
  // point of mirroring loomcycle's parser is that the two agree; a test that
  // only checks "rejected" would let the wording drift apart unnoticed, and the
  // wording is what the operator acts on.
  it.each([
    ["", "empty path"],
    ["   ", "empty path"],
    ["a.b", "path must start with $"],
    ["$..title", "recursive descent (..) not supported"],
    ["$.items[*]", "wildcard (*) not supported"],
    ["$.items[?(@.x)]", "filter expressions not supported"],
    ["$.items[@]", "filter expressions not supported"],
    ["$.a[0", "unterminated [ index"],
    ["$.a[-1]", 'invalid array index "-1"'],
    ["$.a[x]", 'invalid array index "x"'],
    ["$.a[]", 'invalid array index ""'],
    ["$.a[1.5]", 'invalid array index "1.5"'],
    ["$a", 'unexpected character "a" in path'],
    ["$.a.", "empty key segment"],
  ])("rejects %s", (path, message) => {
    expect(parseJsonPath(path)).toBe(message);
  });

  it("reports recursive descent BEFORE the segment walk", () => {
    // Ordering is load-bearing: `$..a` also reads as an empty key segment, so
    // without the early check the operator is told the wrong thing about a
    // path whose actual problem is that the grammar has no `..`.
    expect(parseJsonPath("$..a")).toBe("recursive descent (..) not supported");
  });
});
