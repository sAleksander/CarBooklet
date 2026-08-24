import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./fixtures/env";

/**
 * AUTH SETUP — runs once, before every other project (see `dependencies` in
 * playwright.config.ts), and leaves a signed-in session on disk at
 * `playwright/.auth/user.json`.
 *
 * Why this exists alongside the per-test `signedInPage` fixture, rather than
 * replacing it:
 *
 *   - A storageState is ONE user's session. Tests that need two users at once
 *     (R3 / cross-user isolation) or that must own their data outright cannot
 *     use it — they keep `signedInPage`, which seeds and deletes a throwaway
 *     user per test.
 *   - Everything else — future tests that only need "somebody is logged in" —
 *     should start from this state instead of paying a UI sign-in each time.
 *     Signing in through the form is slow and, per the E2E rules, not what a
 *     test should be spending its assertions on.
 *
 * The shared user is seeded idempotently, so a cold checkout, a wiped local
 * database, and CI all work without a manual step. The file itself is
 * gitignored — it holds a real session token and is regenerated on demand.
 */

const STORAGE_STATE = "playwright/.auth/user.json";

/**
 * Fixed, not runId-suffixed: this user is meant to persist across runs, which
 * is the entire point of caching its session. It is namespaced under the same
 * @carbooklet.test domain as the throwaway users so local data stays easy to
 * identify and purge.
 */
const SHARED_EMAIL = "e2e-shared@carbooklet.test";
const SHARED_PASSWORD = "E2e-shared-user!1";

setup("authenticate the shared user", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");

  // Seed through the service-role client, exactly as the `user` fixture does.
  // Re-running must be harmless, so an "already registered" error is the
  // success path, not a failure — any other error is real and should surface.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email: SHARED_EMAIL,
    password: SHARED_PASSWORD,
    email_confirm: true,
  });
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new Error(`could not seed the shared user: ${error.message}`);
  }

  // Pin the locale BEFORE signing in, so it is captured in the saved state.
  // Every accessible name in this app comes from i18n and the locale is a
  // `lang` cookie — a storageState carrying `lang=pl` would break every
  // English name-based locator that loads it.
  await context.addCookies([{ name: "lang", value: "en", url: baseURL }]);

  await page.goto("/auth/signin");

  // Wait for hydration before filling — see the long note in
  // fixtures/app.ts; SignInForm's controlled inputs discard anything typed
  // before React mounts.
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 30_000 });

  // Same locator notes as the `signedInPage` fixture: `exact: true` keeps
  // "Password" from also matching the "Show password" toggle's aria-label.
  await page.getByLabel("Email", { exact: true }).fill(SHARED_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(SHARED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the signed-in STATE, never a URL: sign-in lands on /, /dashboard
  // or /cars depending on whether a car is selected. "Sign out" is rendered
  // only by the authenticated shell, so it means signed-in wherever we land.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });

  await context.storageState({ path: STORAGE_STATE });
});
