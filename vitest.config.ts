import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // ydoc.ts wires IndexedDB persistence at import time; tests run headless
    setupFiles: ["./src/test/setup.ts"],
  },
});
