// A mirror of loomcycle's `internal/jsonpath` Parse, for validation only.
//
// WHY the canvas needs a JSONPath parser at all: a Starter's `binds` maps a
// variable name to a path over the SOURCE MESSAGE, and the runtime validates
// each one at create/fork. Without this, every malformed path is a save-time
// rejection instead of a red field while drawing — which is the whole point of
// the validation mirror.
//
// WHY mirroring is safe here where it usually is not: the grammar is a strict
// subset — root, dot keys, non-negative array indices — and everything else
// (wildcards, recursive descent, filters, the quoted-key form) is rejected at
// parse. loomcycle's own header calls that a security property rather than a
// simplification, because these paths project attacker-influenceable documents.
// A tiny exhaustive grammar is one of the few things worth reimplementing: the
// rejection surface is small enough to match line for line.
//
// There is NO evaluator here on purpose. The canvas never resolves a path
// against a document; it only says whether the runtime would accept it.

/** Validate a strict-subset JSONPath. Returns an operator-facing error message,
 *  or null when the path parses. Messages match the Go errors verbatim so the
 *  shared fixture set can assert one string against both implementations. */
export function parseJsonPath(path: string): string | null {
  const p = path.trim();
  if (!p) return "empty path";
  if (p[0] !== "$") return "path must start with $";

  // These three run BEFORE the segment walk, mirroring Go, so the message names
  // the actual violation rather than whatever the walk trips over first.
  if (p.includes("..")) return "recursive descent (..) not supported";
  if (p.includes("*")) return "wildcard (*) not supported";
  if (p.includes("?") || p.includes("@")) return "filter expressions not supported";

  let rest = p.slice(1); // strip the leading $
  while (rest.length) {
    if (rest[0] === ".") {
      rest = rest.slice(1);
      // Read a key up to the next '.' or '['.
      const end = indexOfAny(rest, ".[");
      const key = end === -1 ? rest : rest.slice(0, end);
      rest = end === -1 ? "" : rest.slice(end);
      if (key === "") return "empty key segment";
      continue;
    }
    if (rest[0] === "[") {
      const end = rest.indexOf("]");
      if (end === -1) return "unterminated [ index";
      const idxStr = rest.slice(1, end);
      const idx = Number(idxStr.trim());
      // Only non-negative integers. Number("") is 0 and Number("1.5") is 1.5,
      // neither of which Go's Atoi accepts, so both are checked explicitly.
      if (!idxStr.trim() || !Number.isInteger(idx) || idx < 0) {
        return `invalid array index ${JSON.stringify(idxStr)}`;
      }
      rest = rest.slice(end + 1);
      continue;
    }
    return `unexpected character ${JSON.stringify(rest[0])} in path`;
  }
  return null;
}

/** Go's strings.IndexAny over a two-character set. */
function indexOfAny(s: string, chars: string): number {
  for (let i = 0; i < s.length; i++) {
    if (chars.includes(s[i])) return i;
  }
  return -1;
}
