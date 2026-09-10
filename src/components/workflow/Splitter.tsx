import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// A drag handle between two panes. Drift-free: it records the size + pointer
// position at drag start and sets an absolute size from the total delta
// (accumulating deltas drifts once a clamp is hit). Pointer capture keeps the
// drag alive over iframes (the mermaid diagram / chat embeds), which would
// otherwise swallow the move events.
//
// orientation "vertical" = a vertical bar between horizontal panes (resizes
// width, uses clientX); "horizontal" = a horizontal bar between stacked panes
// (resizes height, uses clientY). `invert` is for a trailing-edge handle where
// dragging toward the pane should GROW it (e.g. a right dock, or a bottom pane).
export default function Splitter({
  getSize,
  setSize,
  min,
  max,
  invert = false,
  orientation = "vertical",
  label,
}: {
  getSize: () => number;
  setSize: (n: number) => void;
  min: number;
  max: number;
  invert?: boolean;
  orientation?: "vertical" | "horizontal";
  label: string;
}) {
  const drag = useRef<{ start: number; startSize: number } | null>(null);
  const horizontal = orientation === "horizontal";

  const onPointerDown = (e: ReactPointerEvent) => {
    drag.current = { start: horizontal ? e.clientY : e.clientX, startSize: getSize() };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const pos = horizontal ? e.clientY : e.clientX;
    const delta = (pos - d.start) * (invert ? -1 : 1);
    setSize(Math.max(min, Math.min(max, d.startSize + delta)));
  };
  const end = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className={horizontal ? "wf-splitter horizontal" : "wf-splitter"}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
