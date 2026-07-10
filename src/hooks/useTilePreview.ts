import { useEffect, useRef, useState } from "react";
import type { LoomcycleClient } from "@loomcycle/client";
import { foldTranscript } from "../chat";
import { previewFromMessages, type PreviewLine } from "../lib/tilePreview";

// The tiny in-tile transcript. The aggregate run-state stream carries no text, so
// each tile's last lines come from a getTranscript fetch — but ONLY for tiles the
// user can actually see (in-view gated) and only for runs that have a session,
// so a board of tens of tiles doesn't fan out tens of transcript fetches.
// Re-fetches when `refreshKey` changes (pass the tile's last-transition ts).

export interface TilePreview {
  lines: PreviewLine[];
  loading: boolean;
}

/** Attach the returned ref to the element whose visibility should gate work;
 *  `inView` flips true while it intersects the viewport. */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true); // no observer (tests/SSR) → don't block behavior
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

export function useTilePreview(
  client: LoomcycleClient,
  sessionId: string | undefined,
  refreshKey: string,
  enabled: boolean,
  maxLines = 3,
): TilePreview {
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const t = await client.getTranscript(sessionId, { signal: ac.signal });
        if (cancelled) return;
        setLines(previewFromMessages(foldTranscript(t), maxLines));
      } catch (e) {
        if (!cancelled) console.warn("[board] tile preview fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client, sessionId, refreshKey, enabled, maxLines]);

  return { lines, loading };
}
