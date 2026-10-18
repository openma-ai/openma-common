import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/perf/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // lcov feeds Codecov's patch check (codecov.yml); the summary is for the log.
      reporter: ["lcov", "text-summary"],
      reportsDirectory: "coverage",
    },
  },
});
