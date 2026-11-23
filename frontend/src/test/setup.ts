// Runs before every test file (see `test.setupFiles` in vite.config.ts).
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { setLibrary } from "../store/library";
import { fixtureLibrary } from "../store/testFixtures";

// The app loads the library from GET /api/library at startup; the tests use its fixture (the
// exact answer of the route) instead of a backend.
setLibrary(fixtureLibrary());

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
