import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./Markdown";

// End-to-end through the real pipeline: react-markdown + rehype-highlight (which
// tokenizes the svg source into <span>s) + codeText + GraphicFigure. Regression
// for the empty-graphic bug — the old shallow codeText produced an empty img src
// because it couldn't read text out of the highlight token spans.
describe("Markdown — ```svg fence", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<circle cx="5" cy="5" r="4" fill="#f00"/></svg>';

  it("renders as an image whose data URI carries the full source", () => {
    const html = renderToStaticMarkup(<Markdown>{"```svg\n" + svg + "\n```"}</Markdown>);
    // Non-empty, encoded svg — %3Ccircle proves the body survived tokenizing.
    expect(html).toContain("data:image/svg+xml,%3Csvg");
    expect(html).toContain("%3Ccircle");
    expect(html).toContain('class="graphic-img"');
  });

  it("renders as an image for an svg-bodied ```xml fence too", () => {
    const html = renderToStaticMarkup(<Markdown>{"```xml\n" + svg + "\n```"}</Markdown>);
    expect(html).toContain("data:image/svg+xml,%3Csvg");
  });
});
