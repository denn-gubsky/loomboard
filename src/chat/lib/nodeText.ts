import { isValidElement, type ReactNode } from "react";

/**
 * Recursively collect the text content of a React node — including text nested
 * inside elements. A shallow read misses it: rehype-highlight wraps highlighted
 * source (svg / xml / html / json / …) in `<span>` token elements, so the code
 * element's children are elements, not strings. Used to recover the raw source
 * of a fenced block for diagram / SVG rendering.
 */
export function nodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}
