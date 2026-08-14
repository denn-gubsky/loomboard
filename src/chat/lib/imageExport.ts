// Side effects for the graphic toolbar: rasterize an image data URI to PNG (for
// clipboard), write to the clipboard, and trigger a local download. Kept out of
// graphic.ts so that module stays DOM-free and unit-testable.

/** Whether the async clipboard image API is usable (secure context + support). */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined"
  );
}

/** Draw an image data URI onto a canvas and read it back as a PNG blob. Data
 *  URIs are same-origin, so the canvas is never tainted and toBlob succeeds.
 *  Falls back to a default canvas size when the source reports no intrinsic
 *  dimensions (e.g. a viewBox-only SVG). */
export async function dataUriToPngBlob(dataUri: string): Promise<Blob> {
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = dataUri;
  });
  const w = img.naturalWidth || 512;
  const h = img.naturalHeight || 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    ),
  );
}

/** Copy an image (rasterized to PNG) to the clipboard. */
export async function copyImageToClipboard(dataUri: string): Promise<void> {
  const blob = await dataUriToPngBlob(dataUri);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

/** Copy plain text (the SVG source, in source view). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// Click a transient anchor to save a URL. A data: URL downloads directly; a
// blob: URL is revoked after the click has been dispatched.
function clickDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save a data URI (raster image or encoded SVG) as `filename`. */
export function downloadDataUri(dataUri: string, filename: string): void {
  clickDownload(dataUri, filename);
}

/** Save raw text (the SVG source) as `filename` via a blob URL. */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  clickDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
