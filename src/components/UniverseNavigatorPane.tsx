import { UniverseNavigator } from "@loomcycle/universe";
import "@loomcycle/universe/styles.css";
import type { NavigatorContext } from "@loomcycle/explorer";
import type { Connection } from "../chat/lib/createClient";

// UniverseNavigatorPane is the explorer's `stars` navigator: the 3D star map of
// the scope (loomcycle RFC FQ). It is its own module so DocumentsArea can
// lazy-load it — three.js and the map stay out of the main bundle until a
// reader flips the explorer from `tree` to `stars`.
//
// Every ctx field is passed through on purpose: `subject` is what makes the
// map's memory search work at user scope when `browse` names no one. The
// connection is loomboard's own (bearer, OAuth/session fetch, or the Tauri /
// extension transport) — universe takes the same `{ baseUrl, token?, fetch? }`
// shape, so it goes in as is.
export default function UniverseNavigatorPane({
  ctx,
  connection,
  initialView,
}: {
  ctx: NavigatorContext;
  connection: Connection;
  // A saved star-map view (its document id) to open on once the sky has
  // loaded — how a Boards view lands here. The map reports the view's
  // selection through onSelect, so the explorer's viewer opens it too.
  initialView?: string;
}) {
  return (
    <UniverseNavigator
      connection={connection}
      scope={ctx.scope}
      browse={ctx.browse}
      selection={ctx.selection}
      onSelect={ctx.onSelect}
      reloadToken={ctx.reloadToken}
      maximized={ctx.maximized}
      onToggleMaximize={ctx.onToggleMaximize}
      subject={ctx.subject}
      initialView={initialView}
    />
  );
}
