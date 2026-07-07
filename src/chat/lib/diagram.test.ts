import { describe, it, expect } from "vitest";
import { codeLanguage, isDiagramLanguage, shouldRenderDiagram } from "./diagram";

describe("codeLanguage", () => {
  it("extracts the language from a language-* class", () => {
    expect(codeLanguage("language-mermaid")).toBe("mermaid");
    expect(codeLanguage("language-ts")).toBe("ts");
  });

  it("finds the language class among several classes", () => {
    expect(codeLanguage("hljs language-mermaid")).toBe("mermaid");
  });

  it("lowercases the language", () => {
    expect(codeLanguage("language-Mermaid")).toBe("mermaid");
  });

  it("returns null for inline code (no language class)", () => {
    expect(codeLanguage(undefined)).toBeNull();
    expect(codeLanguage("")).toBeNull();
    expect(codeLanguage("hljs")).toBeNull();
  });
});

describe("isDiagramLanguage", () => {
  it("recognizes mermaid", () => {
    expect(isDiagramLanguage("mermaid")).toBe(true);
  });

  it("rejects non-diagram languages and null", () => {
    expect(isDiagramLanguage("ts")).toBe(false);
    expect(isDiagramLanguage(null)).toBe(false);
  });
});

describe("shouldRenderDiagram", () => {
  it("renders a mermaid block once streaming has finished", () => {
    expect(shouldRenderDiagram("mermaid", false)).toBe(true);
  });

  it("defers a mermaid block while the message is still streaming", () => {
    expect(shouldRenderDiagram("mermaid", true)).toBe(false);
  });

  it("never renders a non-diagram language as a diagram", () => {
    expect(shouldRenderDiagram("ts", false)).toBe(false);
    expect(shouldRenderDiagram(null, false)).toBe(false);
  });
});
