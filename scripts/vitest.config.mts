import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    exclude: [
      "**/__tests__/merchant-queries.test.ts",
      "**/__tests__/merchant-analytics.test.ts",
    ],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
