import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { nodeText } from "./nodeText";

describe("nodeText", () => {
  it("reads a plain string child (unhighlighted fence, e.g. mermaid)", () => {
    expect(nodeText("<svg/>")).toBe("<svg/>");
  });

  it("recovers source nested in highlight token spans", () => {
    // What rehype-highlight produces for a ```svg fence: the source split across
    // nested <span> elements. A shallow read returns "" — the empty-graphic bug.
    const tokens = [
      createElement("span", { key: 1, className: "hljs-tag" }, "<svg "),
      createElement("span", { key: 2 }, [
        "fill=",
        createElement("span", { key: 3, className: "hljs-string" }, '"#f00"'),
      ]),
      createElement("span", { key: 4 }, "></svg>"),
    ];
    expect(nodeText(tokens)).toBe('<svg fill="#f00"></svg>');
  });

  it("skips non-text nodes (null / boolean / undefined)", () => {
    expect(nodeText([null, false, "x", undefined, 42])).toBe("x42");
  });
});
