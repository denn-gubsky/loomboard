// Pure helpers for rendering LLM-generated graphics (SVG + data-URI images) in
// the chat. DOM-free so the routing/encoding logic is unit-testable without a
// renderer (see graphic.test.ts). The actual <img> render + copy/download side
// effects live in components/GraphicFigure.tsx and lib/imageExport.ts.
//
// Security (CLAUDE.md rule #7 — agent output is untrusted): an SVG document is
// rendered via `<img src="data:image/svg+xml,…">`, NOT injected into the DOM.
// A browser loads an <img>-referenced SVG in "secure static mode" — scripts are
// disabled and external resources (incl. exfiltration beacons) never load — so
// this is isolation, not sanitization. Same posture as the mermaid sandbox.

/** True when a fenced block's content is an SVG document (starts with `<svg`). */
export function looksLikeSvg(code: string): boolean {
  return /^\s*<svg[\s>]/i.test(code) && /<\/svg\s*>/i.test(code);
}

/**
 * Whether a finished fence should render as an SVG graphic. An explicit
 * ```svg fence is trusted by its language; an `xml`/`html`/unlabelled fence is
 * routed only when its body actually is an `<svg>` document (so we don't hijack
 * ordinary XML/HTML code). Deferred while streaming — a half-written document
 * would fail to render and flicker (mirrors shouldRenderDiagram).
 */
export function shouldRenderSvg(
  lang: string | null,
  code: string,
  streaming: boolean,
): boolean {
  if (streaming) return false;
  if (lang === "svg") return true;
  if (lang === null || lang === "xml" || lang === "html") return looksLikeSvg(code);
  return false;
}

/** Encode an SVG document as an `<img>`-safe data URI. encodeURIComponent is
 *  used (not base64) so it handles `#` in colors and any Unicode without the
 *  btoa Latin-1 pitfall. */
export function svgDataUri(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// Raster image data URIs we allow through react-markdown (its default
// urlTransform strips every `data:` URL). Scoped to image/* so a `data:text/html`
// or `data:application/*` payload can never slip in.
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

/** True for a `data:image/<type>` URL we're willing to render. */
export function isDataImageUrl(url: string): boolean {
  return DATA_IMAGE_RE.test(url);
}

/** The MIME type of a data URI, e.g. "image/png" — or null if not a data URI. */
export function dataUriMime(uri: string): string | null {
  const m = /^data:([^;,]+)[;,]/i.exec(uri);
  return m ? m[1].toLowerCase() : null;
}

/** A download filename for a graphic, from its MIME type: "image.svg",
 *  "image.png", … Falls back to ".img" for an unrecognized type. */
export function graphicFilename(mime: string | null, base = "image"): string {
  const ext =
    mime === "image/svg+xml"
      ? "svg"
      : mime === "image/jpeg"
        ? "jpg"
        : mime?.startsWith("image/")
          ? mime.slice("image/".length)
          : "img";
  return `${base}.${ext}`;
}
