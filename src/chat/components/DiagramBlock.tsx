import { useEffect, useId, useRef, useState } from "react";

// Renders a ```mermaid fenced block from agent output as a diagram.
//
// Security (CLAUDE.md rule #7 — agent output is untrusted): we render with
// Mermaid's securityLevel:"sandbox", which emits the diagram inside a data:
// <iframe>. That iframe has an opaque origin, so even if a crafted diagram
// produced active content it cannot reach our page, cookies, or the loomcycle
// token — isolation instead of sanitization. (We can't sanitize the SVG
// ourselves: Mermaid renders flowchart labels as <foreignObject> HTML, which
// DOMPurify strips wholesale, leaving unlabelled boxes.) dangerouslySetInnerHTML
// carries only Mermaid's own iframe wrapper (a fixed <iframe src=data:… style=…>),
// not diagram-derived markup.
//
// mermaid is dynamically imported inside the render effect so it lands in a
// separate chunk loaded on first diagram, not the initial bundle (same lazy
// pattern as lib/extract.ts → pdfjs/mammoth).

type Status = "loading" | "ready" | "error";
type Theme = "light" | "dark";

// Cache the rendered iframe HTML per theme+source so unrelated message-list
// re-renders (and remounts) don't re-run the async Mermaid render.
const htmlCache = new Map<string, string>();

function resolveTheme(el: HTMLElement | null): Theme {
  const themed = el?.closest("[data-theme]") as HTMLElement | null;
  const t = themed?.dataset.theme;
  if (t === "light" || t === "dark") return t;
  // No ancestor sets it (rare) — fall back to OS preference; default dark.
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export default function DiagramBlock({ code }: { code: string }) {
  // Mermaid needs a unique, selector-safe id; useId() contains colons.
  const domId = "d" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(null));

  // Resolve theme from the nearest [data-theme] ancestor and re-resolve when it
  // flips (light/dark toggle), so the diagram re-renders in the matching theme.
  useEffect(() => {
    const wrap = wrapRef.current;
    setTheme(resolveTheme(wrap));
    const themed = wrap?.closest("[data-theme]") as HTMLElement | null;
    if (!themed) return;
    const obs = new MutationObserver(() => setTheme(resolveTheme(wrap)));
    obs.observe(themed, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const key = `${theme}:${code}`;
    const cached = htmlCache.get(key);
    if (cached) {
      setHtml(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "sandbox",
          theme: theme === "light" ? "default" : "dark",
        });
        const { svg } = await mermaid.render(domId, code);
        if (cancelled) return;
        htmlCache.set(key, svg);
        setHtml(svg);
        setStatus("ready");
      } catch {
        // Malformed diagram or failed chunk load — never blank, never throw.
        // On a parse error Mermaid leaves its temporary render node attached to
        // <body>; in sandbox mode that's an <iframe id="i{id}"> (a plain <div
        // id="d{id}"> otherwise). Remove it so a stray error graphic doesn't
        // linger at the end of the page.
        document.getElementById("i" + domId)?.remove();
        document.getElementById("d" + domId)?.remove();
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, theme, domId]);

  return (
    <div ref={wrapRef} className="diagram-wrap">
      {status === "error" ? (
        <div className="diagram-error">
          <div className="diagram-error-note">Diagram failed to render</div>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      ) : status === "ready" && html != null ? (
        <div className="diagram" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="diagram-loading">Rendering diagram…</div>
      )}
    </div>
  );
}
