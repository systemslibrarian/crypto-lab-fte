import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the production build served by `vite preview`, so what passes
 * here is what ships. Two suites:
 *   - a11y.spec.ts    — the axe WCAG A/AA gate, Chromium only (deterministic).
 *   - claims.spec.ts  — the page tells the truth: every printed number is
 *     cross-checked against another surface or re-derived independently.
 *
 * Port 4381 is unique to this lab across the fleet (never the Vite default 4173).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The a11y driver walks every panel and disclosure before scanning, and an
  // encode runs 600k PBKDF2 iterations in the page.
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4381/crypto-lab-fte/"
  },
  projects: [
    {
      name: "a11y",
      testMatch: /a11y\.spec\.ts/,
      // Dark is the only theme this lab ships.
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" }
    },
    { name: "claims", testMatch: /claims\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: {
    // Build before serving: `vite preview` only serves whatever is already in
    // dist/, so without this a failing build leaves the previous good bundle in
    // place and the suite passes green against code that no longer compiles.
    command: "npm run build && npm run preview -- --port 4381 --strictPort",
    url: "http://localhost:4381/crypto-lab-fte/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
