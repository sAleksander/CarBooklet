import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile();
} catch {
  // No .env on disk is fine when the vars are already exported (e.g. CI).
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // Deliberately 0, including on CI. A retry turns a flaky test green and hides
  // the flake; the E2E rules say wait for state instead of papering over races.
  retries: 0,

  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Chromium only. These tests protect application logic, not rendering
  // differences; a second browser would double the runtime for no extra signal.
  //
  // `setup` runs first and writes playwright/.auth/user.json — a signed-in
  // session for the shared test user, handed to every test in this project.
  // Specs that need their own isolated user (cross-user isolation, anything
  // that owns its data) opt back out: e2e/fixtures/app.ts resets storageState
  // to empty for everything built on the `signedInPage` fixture, which is every
  // spec in the suite today. See e2e/auth.setup.ts for why both exist.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  // Serve the production build, not `astro dev`.
  //
  // Two reasons. The suite should exercise what actually ships — bundled,
  // minified, real hydration timing — and it did not: every spec that clicked
  // after navigating was racing hydration and only winning because the dev
  // server was slow. See `gotoHydrated` in e2e/fixtures/app.ts.
  //
  // The second reason is operational. `astro dev` boots the Cloudflare adapter
  // against remote bindings, which is the command implicated in the 2026-09-07
  // version_upload to the live Worker. CI has no business running it.
  //
  // The timeout covers a cold `astro build`, not just server start-up.
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
