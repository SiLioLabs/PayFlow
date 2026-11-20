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
      reporter: ["text", "lcov"],
    },
  },
});
