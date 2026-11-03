import { lazy, Suspense, useMemo } from "react";
import { DocumentViewer, PathExplorer, type DocScope } from "@loomcycle/explorer";
import { useConnection } from "../state/connection";
import type { Connection } from "../chat/lib/createClient";
import { buildConnection } from "../lib/buildConnection";

// The `stars` navigator (loomcycle RFC FQ): the 3D star map of the scope, in
// its own lazy chunk so three.js is fetched only when a reader flips the
// explorer from `tree` to `stars`.
const UniverseNavigatorPane = lazy(() => import("./UniverseNavigatorPane"));

// The Path VFS + chunked-graph Document explorer (@loomcycle/explorer). Same
// connection/principal seam as the Library. Documents need SQL Memory enabled
// server-side; when it's off the component surfaces the refusal via onError.
//
// `target` is one document another surface asked for (the canvas's "Open in
// Documents" on a result, a chat's linked-document panel): it opens straight
// in the viewer, by id — a document id does not say where it sits in the Path
// tree, so the explorer cannot be pointed at it. The canvas's DocumentTarget
// and a chat link's target both fit; neither's chunk reaches the viewer yet,
// as the explorer has no prop for it (loomcycle G28).
export interface DocTarget {
  documentId: string;
  chunkId?: string;
  scope?: string;
  title?: string;
}

// A saved star-map view another surface asked for (Boards' "Open in the star
// map"): Documents opens on the stars navigator, in the view's scope, and the
// map restores the view once its sky has loaded.
export interface StarView {
  viewId: string;
  scope: "user" | "tenant";
}

export default function DocumentsArea({
  target,
  starView,
  onClearTarget,
}: {
  target?: DocTarget;
  starView?: StarView;
  onClearTarget: () => void;
}) {
  const { settings, principal, signIn } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  if (!connection) return null;
  if (target) {
    return (
      <section className="explorer-pane">
        <header className="explorer-pane__bar">
          <button type="button" onClick={onClearTarget}>
            ← All documents
          </button>
        </header>
        <DocumentViewer
          connection={connection}
          documentId={target.documentId}
          scope={(target.scope ?? "user") as DocScope}
          titleHint={target.title}
          principal={principal ?? undefined}
        />
      </section>
    );
  }
  return (
    <section className="explorer-pane">
      <PathExplorer
        connection={connection}
        principal={principal ?? undefined}
        // `navigator` asks the explorer for stars (and is remembered like the
        // toggle); `defaultScope` is read once, on mount — Boards always
        // mounts Documents afresh, so a view lands in its own scope.
        navigator={starView ? "stars" : undefined}
        defaultScope={starView?.scope}
        onError={(e) => console.error("[explorer]", e)}
        // Supplying the slot is what makes the explorer show its `tree | stars`
        // toggle (persisted under localStorage `loomcycle.explorer.navigator`);
        // the tree stays the default. The `target` branch above is a single
        // DocumentViewer and has no navigator.
        renderNavigator={(ctx) => (
          <Suspense fallback={<div className="explorer-pane__loading">Loading the star map…</div>}>
            <UniverseNavigatorPane ctx={ctx} connection={connection} initialView={starView?.viewId} />
          </Suspense>
        )}
      />
    </section>
  );
}
