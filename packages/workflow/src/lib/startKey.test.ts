import { describe, expect, it } from "vitest";
import { newStartKey, startAttempt, startPrint } from "./startKey";

describe("startPrint — what a start starts", () => {
  it("is the same for the same version, input and variables, whatever order the variables come in", () => {
    expect(startPrint({ defId: "d1", input: "go", vars: { a: "1", b: "2" } })).toBe(startPrint({ defId: "d1", input: "go", vars: { b: "2", a: "1" } }));
    expect(startPrint({ defId: "d1" })).toBe(startPrint({ defId: "d1", input: "", vars: {} }));
  });

  it("differs when the version, the input or a variable differs", () => {
    const base = startPrint({ defId: "d1", input: "go", vars: { a: "1" } });
    expect(startPrint({ defId: "d2", input: "go", vars: { a: "1" } })).not.toBe(base);
    expect(startPrint({ defId: "d1", input: "stop", vars: { a: "1" } })).not.toBe(base);
    expect(startPrint({ defId: "d1", input: "go", vars: { a: "2" } })).not.toBe(base);
  });
});

describe("startAttempt — one key per start, kept across a retry of it", () => {
  let n = 0;
  const next = () => `k${++n}`;

  it("makes a new key when nothing is pending", () => {
    expect(startAttempt(undefined, "p", next)).toEqual({ key: "k1", print: "p" });
  });

  it("keeps the key for a retry of the same start, so the runtime answers with the walk it already started", () => {
    const first = startAttempt(undefined, "p", next);
    expect(startAttempt(first, "p", next)).toBe(first);
  });

  it("makes a new key when what is started has changed — the old key would hand back the wrong walk", () => {
    const first = startAttempt(undefined, "p", next);
    const second = startAttempt(first, "q", next);
    expect(second.key).not.toBe(first.key);
    expect(second.print).toBe("q");
  });
});

describe("newStartKey", () => {
  it("is within the runtime's grammar and differs each time", () => {
    const a = newStartKey();
    expect(a).toMatch(/^[A-Za-z0-9:._-]{1,200}$/);
    expect(newStartKey()).not.toBe(a);
  });
});
