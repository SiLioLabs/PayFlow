// @ts-ignore — vitest/config types missing from partial install; CI uses full install
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
