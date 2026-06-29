import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkGemoji from "remark-gemoji";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

// Markdown rendering for agent output: GitHub-flavored markdown + tables,
// LaTeX math ($…$ / $$…$$ via KaTeX), :shortcode: emoji, and syntax-highlighted
// code. react-markdown does NOT render raw HTML by default and sanitizes URLs
// (javascript: is stripped), so agent/tool output is rendered as content, never
// executed (CLAUDE.md security rule 7).
const remarkPlugins = [remarkGfm, remarkMath, remarkGemoji];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Memoized so a re-render of the message list doesn't re-parse every finished
// message — only the streaming one (whose text changes) re-parses.
export default memo(MarkdownImpl);
