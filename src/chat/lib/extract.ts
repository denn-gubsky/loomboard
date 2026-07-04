import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth/mammoth.browser.js";
import { isDocx, isPdf } from "./attachments";

// pdf.js needs its worker; Vite hands us a hashed URL for the bundled asset.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Extract plain text from a file: PDF (pdf.js), DOCX (mammoth), or anything
 *  else read as UTF-8 text. Throws on a corrupt/unreadable file. */
export async function extractText(file: File): Promise<string> {
  if (isPdf(file)) return extractPdf(file);
  if (isDocx(file)) return extractDocx(file);
  return (await file.text()).trim();
}

async function extractPdf(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .join(" "),
      );
    }
    return pages.join("\n\n").trim();
  } finally {
    await doc.destroy();
  }
}

async function extractDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value.trim();
}
