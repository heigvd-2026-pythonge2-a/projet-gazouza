/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development, /api calls are forwarded to the FastAPI backend (uvicorn, port 8000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  test: {
    // A simulated browser (DOM, events), so that components can be rendered in the tests.
    environment: "jsdom",
    pool: "vmThreads",
    setupFiles: ["./src/test/setup.ts"],
    // Used by `pnpm test:coverage` only (CI runs it): below a threshold, the command fails.
    coverage: {
      // A little under the rates measured when they were set, so that a PR fails only if it
      // lowers the coverage noticeably. The Konva canvas (Editor.tsx and the layers it draws)
      // cannot be rendered in jsdom, hence the lower total; the pure logic of src/store/ is
      // held higher. Raise them when the coverage goes up, never lower them to pass.
      thresholds: {
        lines: 79,
        statements: 77,
        functions: 76,
        branches: 70,
        "src/store/**": { lines: 95, statements: 95, functions: 95, branches: 85 },
      },
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/api/schema.gen.ts",
        "src/vite-env.d.ts",
      ],
      reporter: ["text", "text-summary", "html", "json-summary"],
    },
  },
});
