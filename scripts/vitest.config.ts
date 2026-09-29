import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment — no browser APIs needed for these unit tests.
    environment: "node",
    // Match files ending in .test.ts within the scripts directory.
    include: ["**/*.test.ts"],
    // Exclude frontend tests and node_modules.
    exclude: ["node_modules/**", "../frontend/**"],
  },
});
