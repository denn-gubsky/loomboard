import { describe, expect, it, vi } from "vitest";
import { extractText } from "./extract";

// In the browser Vite serves the worker at a URL; under Node pdf.js imports it
// on the main thread, so hand it the file itself.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: new URL("../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href,
}));

// A one-page PDF showing `text` in Helvetica, built by hand so the test needs
// no fixture file. The xref offsets are computed, so it parses without repair;
// it is all ASCII, so string offsets are byte offsets.
function pdfWith(text: string): string {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

describe("extractText", () => {
  it("returns the text of a PDF's pages", async () => {
    const file = new File([pdfWith("Hello from loomboard")], "note.pdf", { type: "application/pdf" });
    expect(await extractText(file)).toBe("Hello from loomboard");
  });

  it("reads a non-PDF, non-DOCX file as trimmed UTF-8 text", async () => {
    const file = new File(["  plain notes \n"], "notes.txt", { type: "text/plain" });
    expect(await extractText(file)).toBe("plain notes");
  });
});
