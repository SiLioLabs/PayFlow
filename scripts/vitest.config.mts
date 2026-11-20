import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: [
      {
        find: /^(node:)?sqlite$/,
        replacement: fileURLToPath(new URL("./__tests__/support/node-sqlite.ts", import.meta.url)),
      },
    ],
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "batch-optimizer.ts", "event-dedup.ts"],
      thresholds: {
        global: {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
      },
    },
  },
});
