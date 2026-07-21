import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/index.ts", "src/progress.ts", "src/core/types.ts"],
      thresholds: {
        lines: 75,
        functions: 75,
        statements: 75,
        branches: 55,
      },
    },
  },
});
