import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// A vertical drag handle between two horizontal panes. Drift-free: it records
// the size + pointer x at drag start and sets an absolute size from the total
// delta (accumulating deltas drifts once a clamp is hit). Pointer capture keeps
// the drag alive over iframes (the mermaid diagram / chat embeds), which would
// otherwise swallow the move events. `invert` is for a right-edge handle where
// dragging left should GROW the pane to its right.
export default function Splitter({
  getSize,
  setSize,
  min,
  max,
  invert = false,
  label,
}: {
  getSize: () => number;
  setSize: (n: number) => void;
  min: number;
  max: number;
  invert?: boolean;
  label: string;
}) {
  const drag = useRef<{ startX: number; startSize: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    drag.current = { startX: e.clientX, startSize: getSize() };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = (e.clientX - d.startX) * (invert ? -1 : 1);
    setSize(Math.max(min, Math.min(max, d.startSize + delta)));
  };
  const end = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className="wf-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
