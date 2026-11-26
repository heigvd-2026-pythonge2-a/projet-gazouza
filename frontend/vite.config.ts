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
    // Used by `pnpm test:coverage` only. No threshold yet: CI reports the rate without failing.
    coverage: {
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
