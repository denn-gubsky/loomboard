import { useMemo } from "react";
import { DocumentViewer, PathExplorer, type DocScope } from "@loomcycle/explorer";
import type { DocumentTarget } from "@loomboard/workflow";
import { useConnection } from "../state/connection";
import type { Connection } from "../chat/lib/createClient";
import { buildConnection } from "../lib/buildConnection";

// The Path VFS + chunked-graph Document explorer (@loomcycle/explorer). Same
// connection/principal seam as the Library. Documents need SQL Memory enabled
// server-side; when it's off the component surfaces the refusal via onError.
//
// `target` is one document another surface asked for (the canvas's "Open in
// Documents" on a result): it opens straight in the viewer, by id — a document
// id does not say where it sits in the Path tree, so the explorer cannot be
// pointed at it.
export default function DocumentsArea({ target, onClearTarget }: { target?: DocumentTarget; onClearTarget: () => void }) {
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
        onError={(e) => console.error("[explorer]", e)}
      />
    </section>
  );
}
