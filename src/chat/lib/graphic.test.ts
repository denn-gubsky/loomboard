import { describe, it, expect } from "vitest";
import {
  looksLikeSvg,
  shouldRenderSvg,
  svgDataUri,
  isDataImageUrl,
  dataUriMime,
  graphicFilename,
} from "./graphic";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';

describe("looksLikeSvg", () => {
  it("accepts an svg document (leading whitespace ok)", () => {
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg("\n  " + SVG)).toBe(true);
  });
  it("rejects non-svg / unterminated content", () => {
    expect(looksLikeSvg("<div>hi</div>")).toBe(false);
    expect(looksLikeSvg("<svg><circle/>")).toBe(false); // no closing tag
    expect(looksLikeSvg("plain text")).toBe(false);
  });
});

describe("shouldRenderSvg", () => {
  it("renders an explicit ```svg fence by its language", () => {
    expect(shouldRenderSvg("svg", SVG, false)).toBe(true);
  });
  it("renders an svg-bodied xml/html/unlabelled fence", () => {
    expect(shouldRenderSvg("xml", SVG, false)).toBe(true);
    expect(shouldRenderSvg("html", SVG, false)).toBe(true);
    expect(shouldRenderSvg(null, SVG, false)).toBe(true);
  });
  it("leaves ordinary code fences alone", () => {
    expect(shouldRenderSvg("js", SVG, false)).toBe(false); // wrong language
    expect(shouldRenderSvg("xml", "<note>hi</note>", false)).toBe(false); // not svg
  });
  it("defers while the message is still streaming", () => {
    expect(shouldRenderSvg("svg", SVG, true)).toBe(false);
  });
});

describe("svgDataUri", () => {
  it("encodes so `#` colors survive the data URI", () => {
    const uri = svgDataUri('<svg fill="#ff4444"/>');
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(uri).toContain("%23ff4444"); // # is percent-encoded, not a fragment
    expect(uri).not.toContain("#ff4444");
  });
});

describe("isDataImageUrl", () => {
  it("allows raster + svg image data URIs", () => {
    expect(isDataImageUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isDataImageUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isDataImageUrl("data:image/svg+xml,%3Csvg")).toBe(true);
  });
  it("rejects non-image and active-content data/URLs", () => {
    expect(isDataImageUrl("data:text/html,<script>")).toBe(false);
    expect(isDataImageUrl("data:application/json,{}")).toBe(false);
    expect(isDataImageUrl("javascript:alert(1)")).toBe(false);
    expect(isDataImageUrl("https://example.com/x.png")).toBe(false);
  });
});

describe("dataUriMime / graphicFilename", () => {
  it("reads the mime and derives a filename", () => {
    expect(dataUriMime("data:image/png;base64,AAAA")).toBe("image/png");
    expect(dataUriMime("data:image/svg+xml,%3Csvg")).toBe("image/svg+xml");
    expect(dataUriMime("not-a-data-uri")).toBeNull();

    expect(graphicFilename("image/svg+xml")).toBe("image.svg");
    expect(graphicFilename("image/jpeg")).toBe("image.jpg");
    expect(graphicFilename("image/png")).toBe("image.png");
    expect(graphicFilename(null)).toBe("image.img");
  });
});
