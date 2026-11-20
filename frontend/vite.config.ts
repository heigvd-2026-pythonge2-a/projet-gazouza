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
  test: {
    // A simulated browser (DOM, events), so that components can be rendered in the tests.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
