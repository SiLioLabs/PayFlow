import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/__tests__/**", "src/setupTests.ts"],
      reporter: ["text", "html", "lcov"],
      reportOnFailure: true,
      thresholds: {
        lines: 20,
        functions: 15,
        branches: 10,
        statements: 20,
        "src/hooks/**": {
          lines: 25,
          functions: 15,
          branches: 10,
          statements: 25,
        },
        "src/utils/**": {
          lines: 35,
          functions: 25,
          branches: 15,
          statements: 35,
        },
      },
    },
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
