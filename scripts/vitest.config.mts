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
    include: ["**/__tests__/**/*.test.ts", "**/db/**/*.test.ts"],
    exclude: [
      "**/__tests__/merchant-queries.test.ts",
      "**/__tests__/merchant-analytics.test.ts",
    ],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
