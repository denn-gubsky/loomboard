import type { ImageMediaType } from "@loomcycle/client";

// Anthropic's guidance: a long edge beyond ~1568px is downscaled server-side
// anyway, so resampling there cuts payload + tokens with no quality loss.
const MAX_EDGE = 1568;
// JPEG quality for photographic re-encode (PNG sources keep PNG for crisp
// graphics / transparency).
const JPEG_QUALITY = 0.85;

export interface ResampledImage {
  mediaType: ImageMediaType;
  data: string; // base64, no "data:" prefix
  dataUrl: string; // for the thumbnail preview
  width: number;
  height: number;
}

/** Downscale an image to a sane max edge and re-encode it, returning base64 +
 *  a data URL. Output media type is always png or jpeg (both whitelisted by the
 *  wire), regardless of the source (gif/webp flatten to a frame). */
export async function resampleImage(file: File): Promise<ResampledImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2D canvas context");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const keepPng = file.type === "image/png";
    const mediaType: ImageMediaType = keepPng ? "image/png" : "image/jpeg";
    const dataUrl = keepPng
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

    return { mediaType, data, dataUrl, width, height };
  } finally {
    bitmap.close();
  }
}
