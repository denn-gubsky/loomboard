// Pure helpers for deciding when a fenced code block should render as a diagram
// instead of syntax-highlighted source. Kept DOM-free so the decision logic is
// unit-testable without a renderer (see diagram.test.ts). The actual Mermaid
// render + SVG sanitization lives in components/DiagramBlock.tsx.

/**
 * Extract the language from a react-markdown `code` element's className
 * (e.g. "language-mermaid" -> "mermaid"). Returns null for inline code, which
 * carries no `language-*` class.
 */
export function codeLanguage(className?: string): string | null {
  const m = /(?:^|\s)language-([\w-]+)/.exec(className ?? "");
  return m ? m[1].toLowerCase() : null;
}

// Fence languages we render as diagrams rather than code. A set so adding a
// second engine (e.g. "d2") later is a one-line change here + a branch in
// DiagramBlock.
const DIAGRAM_LANGUAGES = new Set(["mermaid"]);

export function isDiagramLanguage(lang: string | null): boolean {
  return lang != null && DIAGRAM_LANGUAGES.has(lang);
}

/**
 * Whether a fence of `lang` should render as a diagram *now*. We defer while the
 * message is still streaming: the source is only partially written, so parsing
 * it every token would fail and flicker. The block shows as plain code until the
 * turn finalizes, then swaps to the rendered diagram.
 */
export function shouldRenderDiagram(lang: string | null, streaming: boolean): boolean {
  return isDiagramLanguage(lang) && !streaming;
}
