import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  define: { __CORKO_VERSION__: JSON.stringify(VERSION) },
  test: {
    environment: "node",
    // ydoc.ts wires IndexedDB persistence at import time; tests run headless
    setupFiles: ["./src/test/setup.ts"],
  },
});
