// jsdom shims for @xyflow/react.
//
// The library measures its viewport and transforms node positions, so it
// reaches for three browser APIs jsdom does not implement. Without these it
// throws on mount and every render test fails for a reason that has nothing
// to do with the component under test.
//
// These are deliberately minimal — enough to let the component tree mount and
// render, not enough to simulate real geometry. A test that depends on actual
// measured sizes would be testing jsdom, not us.

// setupFiles runs for EVERY test file, including the node-environment ones
// where none of these globals exist. Bail out rather than throwing on
// HTMLElement.
const hasDOM = typeof globalThis.HTMLElement !== "undefined";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (hasDOM) {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor(_transform?: string) {}
  } as unknown as typeof DOMMatrixReadOnly;

  // xyflow reads offsetWidth/offsetHeight to size the pane; jsdom reports 0
  // for everything, which makes it bail out of rendering entirely.
  for (const prop of ["offsetWidth", "offsetHeight"] as const) {
    if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)?.get) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        value: prop === "offsetWidth" ? 800 : 600,
      });
    }
  }

  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}
