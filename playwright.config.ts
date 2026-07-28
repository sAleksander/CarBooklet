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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
