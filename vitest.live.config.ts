import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live/**/*.live.ts"],
    fileParallelism: false,
    testTimeout: 12 * 60 * 1000,
    hookTimeout: 60_000,
  },
});
