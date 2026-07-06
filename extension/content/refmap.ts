// ref → live Element for the CURRENT snapshot. Rebuilt on each read_page so a
// command's ref resolves against the latest DOM. Strong refs, but bounded to the
// page's actionable elements and replaced every snapshot; a full navigation
// reloads the content script (and this module) anyway.

const map = new Map<string, Element>();
let counter = 0;

export function resetRefs(): void {
  map.clear();
  counter = 0;
}

export function assignRef(el: Element): string {
  const ref = `e${++counter}`;
  map.set(ref, el);
  return ref;
}

export function resolveRef(ref: string): Element | null {
  return map.get(ref) ?? null;
}
