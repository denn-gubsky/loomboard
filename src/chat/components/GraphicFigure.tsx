import { useCallback, useState } from "react";
import { Code, Image as ImageIcon, Copy, Check, Download } from "lucide-react";
import { svgDataUri, dataUriMime, graphicFilename } from "../lib/graphic";
import {
  canCopyImage,
  copyImageToClipboard,
  copyText,
  downloadDataUri,
  downloadText,
} from "../lib/imageExport";

// Renders an LLM-generated graphic — an SVG document (from a fenced block) or a
// data-URI raster image (from a markdown image) — as a picture, with a toolbar
// to flip an SVG to its source, copy the image to the clipboard, and download.
//
// Security: an SVG is shown via `<img src="data:image/svg+xml,…">`, so the
// browser loads it in secure static mode (no scripts, no external fetches). We
// never inject the SVG markup into the page. See lib/graphic.ts.

interface Props {
  /** Raw `<svg>` source from a fenced block — enables the source toggle and a
   *  `.svg` download. Mutually exclusive with `dataUri`. */
  source?: string;
  /** A `data:image/*` URI from a markdown image. */
  dataUri?: string;
  alt?: string;
}

type Mode = "image" | "source";
type Flash = "idle" | "copied" | "error";

export default function GraphicFigure({ source, dataUri, alt }: Props) {
  const isSvg = source != null;
  const uri = isSvg ? svgDataUri(source) : (dataUri ?? "");
  const [mode, setMode] = useState<Mode>("image");
  const [imgError, setImgError] = useState(false);
  const [flash, setFlash] = useState<Flash>("idle");

  const flashDone = useCallback((ok: boolean) => {
    setFlash(ok ? "copied" : "error");
    setTimeout(() => setFlash("idle"), 1500);
  }, []);

  const onCopy = useCallback(async () => {
    try {
      if (isSvg && mode === "source") {
        await copyText(source);
      } else if (canCopyImage()) {
        await copyImageToClipboard(uri);
      } else if (isSvg) {
        await copyText(source); // no image clipboard — fall back to the source
      } else {
        throw new Error("image clipboard unavailable");
      }
      flashDone(true);
    } catch {
      flashDone(false);
    }
  }, [isSvg, mode, source, uri, flashDone]);

  const onDownload = useCallback(() => {
    if (isSvg) downloadText(source, "image.svg", "image/svg+xml");
    else downloadDataUri(uri, graphicFilename(dataUriMime(uri)));
  }, [isSvg, source, uri]);

  // An SVG that fails to load as an image locks to its source (still copyable).
  const showSource = isSvg && (mode === "source" || imgError);

  // Phrasing-content markup only (span / code / button / img) so the same
  // component is valid both as a block (the ```svg fence) and inline inside a
  // markdown paragraph (a data-URI image renders as <p><img></p>).
  return (
    <span className="graphic">
      <span className="graphic-toolbar">
        {isSvg && !imgError && (
          <button
            type="button"
            className="graphic-btn"
            onClick={() => setMode((m) => (m === "image" ? "source" : "image"))}
            title={mode === "image" ? "View source" : "View image"}
          >
            {mode === "image" ? <Code size={13} /> : <ImageIcon size={13} />}
            <span>{mode === "image" ? "Source" : "Image"}</span>
          </button>
        )}
        <button
          type="button"
          className="graphic-btn"
          onClick={onCopy}
          title="Copy image to clipboard"
        >
          {flash === "copied" ? <Check size={13} /> : <Copy size={13} />}
          <span>
            {flash === "copied" ? "Copied" : flash === "error" ? "Failed" : "Copy"}
          </span>
        </button>
        <button
          type="button"
          className="graphic-btn"
          onClick={onDownload}
          title="Download"
        >
          <Download size={13} /> <span>Save</span>
        </button>
      </span>
      {showSource ? (
        <code className="graphic-source">{source}</code>
      ) : !isSvg && imgError ? (
        <span className="graphic-error">Image failed to render</span>
      ) : (
        <img
          className="graphic-img"
          src={uri}
          alt={alt || "graphic"}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      )}
    </span>
  );
}
