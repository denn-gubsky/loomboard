import { Children, isValidElement, memo, useMemo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkGemoji from "remark-gemoji";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import DiagramBlock from "./DiagramBlock";
import GraphicFigure from "./GraphicFigure";
import { codeLanguage, shouldRenderDiagram } from "../lib/diagram";
import { shouldRenderSvg, isDataImageUrl } from "../lib/graphic";
import { nodeText } from "../lib/nodeText";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

// Markdown rendering for agent output: GitHub-flavored markdown + tables,
// LaTeX math ($…$ / $$…$$ via KaTeX), :shortcode: emoji, and syntax-highlighted
// code. react-markdown does NOT render raw HTML by default and sanitizes URLs
// (javascript: is stripped), so agent/tool output is rendered as content, never
// executed (CLAUDE.md security rule 7).
const remarkPlugins = [remarkGfm, remarkMath, remarkGemoji];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

// Allow `data:image/*` URLs (react-markdown's default strips every data: URL) so
// LLM/tool-emitted base64 images render, while keeping the default sanitization
// (javascript:, etc.) for everything else.
function urlTransform(url: string): string {
  return isDataImageUrl(url) ? url : defaultUrlTransform(url);
}

type CodeProps = { className?: string; children?: ReactNode };

// A fenced block is hast `pre > code`; react-markdown renders it as a single
// <code> React element inside <pre>. Pull that element out so we can read its
// language and raw source. (rehype-highlight leaves an unknown language like
// "mermaid" as a single text child, so the source is intact — verified.)
function codeChild(children: ReactNode): ReactElement<CodeProps> | null {
  const el = Children.toArray(children).find(
    (c) => isValidElement(c) && c.type === "code",
  );
  return isValidElement(el) ? (el as ReactElement<CodeProps>) : null;
}

// Recover the fenced source. rehype-highlight tokenizes recognized languages
// (svg/xml/html/json/…) into nested <span>s, so a shallow read of the top-level
// children returns "" — nodeText walks the tree to reconstruct the raw text.
function codeText(el: ReactElement<CodeProps>): string {
  return nodeText(el.props.children).replace(/\n$/, "");
}

function MarkdownImpl({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  // A ```mermaid fence renders as a diagram once the turn finishes; while the
  // message is still streaming the source is only partly written, so we leave
  // it as a normal (highlighted) code block until then. Everything that isn't a
  // ready diagram falls through to the default <pre>, unchanged.
  const components = useMemo<Components>(
    () => ({
      pre({ node: _node, children: preChildren, ...rest }) {
        const code = codeChild(preChildren);
        const lang = codeLanguage(code?.props.className);
        const src = code ? codeText(code) : "";
        if (code && shouldRenderDiagram(lang, streaming)) {
          return <DiagramBlock code={src} />;
        }
        // A ```svg (or svg-bodied) fence renders as an image once finalized.
        if (code && shouldRenderSvg(lang, src, streaming)) {
          return <GraphicFigure source={src} />;
        }
        return <pre {...rest}>{preChildren}</pre>;
      },
      // A data:image/* markdown image renders with copy/download; other images
      // (remote/relative) stay a plain constrained <img>.
      img({ node: _node, src, alt }) {
        if (typeof src === "string" && isDataImageUrl(src)) {
          return (
            <GraphicFigure
              dataUri={src}
              alt={typeof alt === "string" ? alt : undefined}
            />
          );
        }
        return (
          <img
            src={typeof src === "string" ? src : undefined}
            alt={alt}
            className="msg-md-img"
            loading="lazy"
          />
        );
      },
    }),
    [streaming],
  );

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Memoized so a re-render of the message list doesn't re-parse every finished
// message — only the streaming one (whose text / streaming flag changes)
// re-parses.
export default memo(MarkdownImpl);
