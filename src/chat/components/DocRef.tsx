import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Eye, FileText, Loader2, TextQuote, TriangleAlert } from "lucide-react";
import type { DocPreviewResult } from "../lib/docPreview";
import type { DocRef as DocRefTarget } from "../lib/docRefs";
import { nodeText } from "../lib/nodeText";
import { useDocLinks } from "../hooks/useDocLinks";

const SHOW_DELAY_MS = 200;
// Long enough to cross the gap from the control into the popover.
const HIDE_DELAY_MS = 150;
const POP_WIDTH = 360;
// Room the popover needs below its control before it flips above.
const POP_ROOM = 280;

// The excerpt is agent-written text cut mid-document: plain GitHub Markdown,
// and links inside it are text only, so a preview never opens a second preview.
const excerptComponents = {
  a: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  img: ({ alt }: { alt?: string }) => <span>{alt ? `[${alt}]` : ""}</span>,
};

function placement(el: HTMLElement): CSSProperties {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(POP_WIDTH, vw - 16);
  const left = Math.max(8, Math.min(r.left - 12, vw - width - 8));
  return vh - r.bottom > POP_ROOM || r.top < POP_ROOM
    ? { left, width, top: r.bottom + 6 }
    : { left, width, bottom: vh - r.top + 6 };
}

/**
 * A cited document or chunk: its title, then two small controls. The first
 * previews it (hover or focus; a tap on touch), the second opens it in the
 * host. Outside a <Chat> it is just the title.
 */
export default function DocRef({ target, children }: { target: DocRefTarget; children: ReactNode }) {
  const links = useDocLinks();
  const [result, setResult] = useState<DocPreviewResult | undefined>(() => links?.previews.peek(target));
  const [pop, setPop] = useState<{ style: CSSProperties; host: Element } | null>(null);
  const ctl = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointer = useRef<string>("mouse");

  useEffect(() => () => clearTimeout(timer.current), []);
  // A fixed popover would float away from its control on scroll: close it.
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pop]);

  if (!links) return <span className="docref">{children}</span>;
  const { previews, open } = links;

  const load = () => previews.load(target).then(setResult);
  const show = () => {
    clearTimeout(timer.current);
    // Into the chat's root rather than beside the link: the popover holds
    // block Markdown, which may not sit inside the paragraph the link is in,
    // and the root carries the theme tokens that document.body does not.
    const el = ctl.current;
    if (el) setPop({ style: placement(el), host: el.closest(".loomchat") ?? document.body });
    if (!result) void load();
  };
  const showSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(show, SHOW_DELAY_MS);
  };
  const hideSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPop(null), HIDE_DELAY_MS);
  };
  // Escape closes the popover. Stopping it here keeps it from the chat's
  // window-level Escape, which would cancel the running turn.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && pop) {
      e.stopPropagation();
      setPop(null);
      ctl.current?.focus();
    }
  };

  const title = nodeText(children).trim() || undefined;
  const go = async () => {
    if (!open) return;
    if (target.kind === "doc") {
      open({ documentId: target.id, scope: target.scope, title });
      return;
    }
    // A chunk link names only the chunk; its document comes from the preview.
    const res = result ?? (await previews.load(target));
    setResult(res);
    if (res.ok) open({ documentId: res.preview.documentId, chunkId: target.id, scope: target.scope, title });
    else show();
  };

  const missing = result && !result.ok;
  const kindLabel = target.kind === "doc" ? "document" : "section";
  return (
    <span className={missing ? "docref missing" : "docref"} onKeyDown={onKey}>
      {children}
      <button
        ref={ctl}
        type="button"
        className="docref-ctl"
        aria-label={`Preview ${kindLabel}${title ? ` ${title}` : ""}`}
        aria-expanded={pop !== null}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onPointerEnter={(e) => e.pointerType !== "touch" && showSoon()}
        onPointerLeave={(e) => e.pointerType !== "touch" && hideSoon()}
        onFocus={showSoon}
        onBlur={hideSoon}
        // A mouse has already previewed on hover, so its click keeps the
        // popover; a tap or a key toggles it.
        onClick={() => (pointer.current === "mouse" ? show() : pop ? setPop(null) : show())}
      >
        <Eye size={12} />
      </button>
      {open && !(missing && result.notFound) && (
        <button
          type="button"
          className="docref-ctl"
          aria-label={`Open ${kindLabel}${title ? ` ${title}` : ""}`}
          title={`Open ${kindLabel}`}
          onClick={() => void go()}
        >
          <ArrowUpRight size={12} />
        </button>
      )}
      {pop &&
        createPortal(
          <div
            className="docref-pop"
            role="dialog"
            aria-label={`Preview of ${title ?? kindLabel}`}
            style={pop.style}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={hideSoon}
            onFocus={() => clearTimeout(timer.current)}
            onBlur={hideSoon}
          >
            <PreviewBody target={target} result={result} onOpen={open ? () => void go() : undefined} />
          </div>,
          pop.host,
        )}
    </span>
  );
}

function PreviewBody({
  target,
  result,
  onOpen,
}: {
  target: DocRefTarget;
  result: DocPreviewResult | undefined;
  onOpen?: () => void;
}) {
  if (!result) {
    return (
      <span className="docref-pop-status">
        <Loader2 size={14} className="spin" /> Loading…
      </span>
    );
  }
  if (!result.ok) {
    return (
      <span className="docref-pop-status err">
        <TriangleAlert size={14} />
        <span>
          {result.notFound ? "Not found — the id may be wrong, or the item was deleted." : "Not available."}
          <span className="docref-pop-reason">{result.reason}</span>
        </span>
      </span>
    );
  }
  const p = result.preview;
  const Icon = target.kind === "doc" ? FileText : TextQuote;
  return (
    <>
      <span className="docref-pop-head">
        <Icon size={14} />
        <span className="docref-pop-title">{p.title}</span>
      </span>
      {p.documentTitle && <span className="docref-pop-meta">in {p.documentTitle}</span>}
      {(p.type || p.tags.length > 0 || target.scope !== "user") && (
        <span className="docref-pop-meta">
          {[p.type, ...p.tags.map((t) => `#${t}`), target.scope !== "user" ? `${target.scope} scope` : undefined]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      {p.brief && (
        <span className="docref-pop-brief">
          {p.brief}
          {p.stale && <StaleMark />}
        </span>
      )}
      {p.abstract ? (
        // The annotation's abstract, in place of the excerpt. Model-written
        // prose, shown as plain text.
        <p className="docref-pop-abstract">{p.abstract}</p>
      ) : p.excerpt ? (
        <div className="docref-pop-excerpt markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={excerptComponents}>
            {p.truncated ? `${p.excerpt} …` : p.excerpt}
          </ReactMarkdown>
        </div>
      ) : (
        <span className="docref-pop-meta">No text.</span>
      )}
      {p.documentBrief && (
        <span className="docref-pop-meta docref-pop-docbrief">
          {p.documentTitle ? `${p.documentTitle}: ` : "Document: "}
          {p.documentBrief}
          {p.documentBriefStale && <StaleMark />}
        </span>
      )}
      {onOpen && (
        <button type="button" className="docref-pop-open" onClick={onOpen}>
          Open <ArrowUpRight size={13} />
        </button>
      )}
    </>
  );
}

/** A small muted marker: the annotation was written before the text last
 *  changed. Shown, never hidden, so the reader can weigh it. */
function StaleMark() {
  return (
    <span className="docref-pop-stale" title="The text has changed since this summary was written">
      stale
    </span>
  );
}
