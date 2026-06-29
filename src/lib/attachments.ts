import type { ImageMediaType } from "@loomcycle/client";

// Raw size we'll even attempt to read into memory (before extraction/resample).
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// Extensions we extract text from (sent as a fenced untrusted-block).
export const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".html", ".xml", ".log", ".rtf",
  // code
  ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".h",
  ".cpp", ".cc", ".cs", ".rb", ".php", ".sh", ".sql", ".css", ".toml", ".ini",
];

export type AttachmentKind = "image" | "text";
export type AttachmentStatus = "processing" | "ready" | "error";

// A file staged in the composer, before send. Processing (extract text /
// resample image) fills in the kind-specific fields and flips status to ready.
export interface StagedAttachment {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  status: AttachmentStatus;
  error?: string;
  estTokens: number;
  // image
  mediaType?: ImageMediaType;
  data?: string; // resampled base64, no "data:" prefix
  dataUrl?: string; // data: URL for the thumbnail
  width?: number;
  height?: number;
  // text
  text?: string; // extracted (possibly truncated) text
  truncated?: boolean;
}

// What rides along on the sent user message, for rendering in the bubble.
export interface SentAttachment {
  name: string;
  kind: AttachmentKind;
  dataUrl?: string; // image thumbnail
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** Classify a file as an image (vision) or text (extracted) attachment, or
 *  reject it. Images are anything the browser reports as image/*; text is the
 *  known-extension set (incl. PDF/DOCX, handled by dedicated extractors). */
export function classify(file: File): AttachmentKind | null {
  if (file.type.startsWith("image/")) return "image";
  const e = ext(file.name);
  if (e === ".pdf" || e === ".docx" || e === ".doc") return "text";
  if (TEXT_EXTENSIONS.includes(e)) return "text";
  // Some text files arrive with a text/* mime and no known extension.
  if (file.type.startsWith("text/")) return "text";
  return null;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isDocx(file: File): boolean {
  return (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}
