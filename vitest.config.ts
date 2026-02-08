import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["api/__tests__/vitest.setup.ts"],
  },
});
