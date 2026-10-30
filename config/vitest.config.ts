import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts"],
    // Integration test files share one test DB and truncate it between tests.
    fileParallelism: false,
  },
});
