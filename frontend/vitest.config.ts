import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    environmentMatchGlobs: [
      // Conformance tests that read the filesystem run in Node, not jsdom.
      ["src/utils/*.test.ts", "node"],
    ],
    poolOptions: {
      threads: {
        maxThreads: process.env.CI ? 2 : undefined,
        minThreads: 1,
      },
      forks: {
        maxForks: process.env.CI ? 2 : undefined,
        minForks: 1,
      },
    },
  },
});
