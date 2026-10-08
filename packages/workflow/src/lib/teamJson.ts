// A team definition as TEXT (RFC DX): formatting it, parsing it back with the
// position of every value, and naming a place in it by a JSON path.
//
// WHY a parser of its own rather than JSON.parse: the JSON view needs three
// things JSON.parse does not give.
//   - The LINE and COLUMN of a syntax error — engines word and place it
//     differently, and some give only an offset.
//   - DUPLICATE keys refused — JSON.parse keeps the last one silently, so a
//     key typed twice would edit the team without the author seeing which.
//   - Where each value IS, so a finding about `states[3].handler.agent` can
//     be marked on its line.
// Scalars are still decoded by JSON.parse on their own slice, so a string or
// a number means exactly what it means everywhere else.
//
// Pure: no React, no network.

import type { Json, JsonObject } from "./model";

/** A place in a definition: object keys and array indexes, outermost first. */
export type JsonPath = readonly (string | number)[];

export interface TextPosition {
  /** 0-based offset into the text. */
  offset: number;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units, as an editor counts them. */
  column: number;
}

export type ParseResult =
  | { ok: true; def: JsonObject; positions: ReadonlyMap<string, TextPosition> }
  | { ok: false; message: string; position: TextPosition };

/** The definition as the JSON view shows it: two-space indent, the
 *  definition's own key order, a final newline. */
export function formatDefinition(def: JsonObject): string {
  return `${JSON.stringify(def, null, 2)}\n`;
}

/** `states[3].handler.agent`; a key that is not a plain identifier is quoted:
 *  `local.agents["my.agent"]`. */
export function pathToString(path: JsonPath): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

function positionAt(text: string, offset: number): TextPosition {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Parse a definition's text. The root must be an object; a key repeated in
 *  one object is an error at its second occurrence. */
export function parseDefinition(text: string): ParseResult {
  const offsets = new Map<string, number>();
  let i = 0;

  const ws = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const fail = (message: string, at = i): never => {
    throw new ParseError(message, at);
  };
  const describe = (at: number) => (at >= text.length ? "the end of the text" : `${JSON.stringify(text[at])}`);

  const str = (): string => {
    const start = i;
    i++; // the opening quote
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        try {
          return JSON.parse(text.slice(start, i)) as string;
        } catch {
          return fail("invalid escape in a string", start);
        }
      }
      if (c === 92) i += 2;
      else if (c < 32) fail("a control character (such as a line break) inside a string must be escaped");
      else i++;
    }
    return fail("a string is not closed", start);
  };

  const value = (path: (string | number)[]): Json => {
    ws();
    offsets.set(pathToString(path), i);
    const c = text[i];
    if (c === "{") return object(path);
    if (c === "[") return array(path);
    if (c === '"') return str();
    if (c === "t" && text.startsWith("true", i)) return (i += 4), true;
    if (c === "f" && text.startsWith("false", i)) return (i += 5), false;
    if (c === "n" && text.startsWith("null", i)) return (i += 4), null;
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m && m[0]) {
      i += m[0].length;
      return Number(m[0]);
    }
    return fail(`expected a value, found ${describe(i)}`);
  };

  const object = (path: (string | number)[]): JsonObject => {
    i++; // {
    const out: JsonObject = {};
    const seen = new Set<string>();
    ws();
    if (text[i] === "}") return i++, out;
    for (;;) {
      ws();
      if (text[i] !== '"') fail(`expected a key in double quotes, found ${describe(i)}`);
      const keyAt = i;
      const key = str();
      if (seen.has(key)) fail(`the key ${JSON.stringify(key)} appears twice in this object`, keyAt);
      seen.add(key);
      ws();
      if (text[i] !== ":") fail(`expected ":" after the key ${JSON.stringify(key)}, found ${describe(i)}`);
      i++;
      const p = [...path, key];
      out[key] = value(p);
      // A member is located at its KEY: that is the line an author reads as
      // "this field".
      offsets.set(pathToString(p), keyAt);
      ws();
      if (text[i] === ",") {
        i++;
        ws();
        if (text[i] === "}") fail("a trailing comma before } is not allowed in JSON");
        continue;
      }
      if (text[i] === "}") return i++, out;
      fail(`expected "," or "}" after a value, found ${describe(i)}`);
    }
  };

  const array = (path: (string | number)[]): Json[] => {
    i++; // [
    const out: Json[] = [];
    ws();
    if (text[i] === "]") return i++, out;
    for (;;) {
      out.push(value([...path, out.length]));
      ws();
      if (text[i] === ",") {
        i++;
        ws();
        if (text[i] === "]") fail("a trailing comma before ] is not allowed in JSON");
        continue;
      }
      if (text[i] === "]") return i++, out;
      fail(`expected "," or "]" after a value, found ${describe(i)}`);
    }
  };

  try {
    ws();
    if (text[i] !== "{") fail(i >= text.length ? "the text is empty — a team definition is a JSON object" : "a team definition must be a JSON object, starting with {");
    offsets.set("", i);
    const def = object([]);
    ws();
    if (i < text.length) fail(`unexpected ${describe(i)} after the end of the definition`);
    const positions = new Map<string, TextPosition>();
    for (const [p, off] of offsets) positions.set(p, positionAt(text, off));
    return { ok: true, def, positions };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, message: e.message, position: positionAt(text, e.offset) };
    throw e;
  }
}

/** Where `path` is in `text`: the member's key for an object member, the
 *  value for an array element. Falls back to the nearest enclosing place the
 *  text has (a finding about a field the author has not written yet is shown
 *  on its object), and undefined when the text does not parse. */
export function locate(text: string, path: JsonPath): TextPosition | undefined {
  const parsed = parseDefinition(text);
  if (!parsed.ok) return undefined;
  return locateIn(parsed.positions, path);
}

/** `locate`, over positions a caller already has. */
export function locateIn(positions: ReadonlyMap<string, TextPosition>, path: JsonPath): TextPosition | undefined {
  for (let n = path.length; n >= 0; n--) {
    const at = positions.get(pathToString(path.slice(0, n)));
    if (at) return at;
  }
  return undefined;
}

/** The index of the `states` entry the text offset is in, or undefined when
 *  it is outside every state (RFC DX phase 6: the cursor's state).
 *
 *  `positions` holds where each value STARTS, not where it ends, so a state
 *  runs to the start of the next one, and the last to the next top-level key
 *  after `states` — the few characters between its closing brace and the
 *  list's `]` count as the last state's. */
export function stateIndexAt(positions: ReadonlyMap<string, TextPosition>, offset: number): number | undefined {
  const list = positions.get("states")?.offset;
  if (list === undefined) return undefined;
  let end = Infinity;
  for (const [path, at] of positions) {
    // A top-level member: its path is one key, plain or quoted (pathToString).
    if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*|\["(?:[^"\\]|\\.)*"\])$/.test(path) && at.offset > list && at.offset < end) end = at.offset;
  }
  if (offset >= end) return undefined;
  let found: number | undefined;
  for (let i = 0; ; i++) {
    const at = positions.get(pathToString(["states", i]));
    if (!at || at.offset > offset) break;
    found = i;
  }
  return found;
}
