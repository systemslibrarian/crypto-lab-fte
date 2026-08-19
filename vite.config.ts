import { defineConfig } from "vitest/config";

/**
 * GitHub Pages serves this lab from a project subpath, so the base is pinned to
 * the repo name. Nothing in the page may use a root-absolute asset path — under
 * `/crypto-lab-fte/` a `/foo` request 404s.
 */
export default defineConfig({
  base: "/crypto-lab-fte/",
  server: {
    host: true,
    port: 5173
  },
  test: {
    // Playwright specs live in e2e/ and must not be collected by Vitest.
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"]
  }
});
