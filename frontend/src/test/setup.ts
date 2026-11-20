// Runs before every test file (see `test.setupFiles` in vite.config.ts).
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount what a test rendered, so the next one starts from an empty document.
afterEach(() => cleanup());

// jsdom does not lay out the page: elements have no size and never resize. The panels only need
// ResizeObserver to exist.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
