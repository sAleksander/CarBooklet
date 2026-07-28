import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env";

/**
 * Shared E2E fixtures.
 *
 * Setup that is *not* the thing under test lives here, so each spec reads as
 * risk → action → assertion. Every fixture is per-test: no state survives a
 * test, which is what lets the suite run in parallel and be re-run at will.
 */

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * A *second* user, with data, that the test never signs in as. Its only job is
 * to be the victim of an isolation test: rows that exist in the database and
 * must stay invisible to whoever is driving the browser.
 */
export interface ForeignUser {
  id: string;
  car: { id: string; model: string };
  repairEntry: { id: string; description: string };
}

interface AppFixtures {
  /** Collision-proof suffix for anything this test writes to the database. */
  runId: string;
  /** A real, email-confirmed Supabase user, deleted after the test. */
  user: TestUser;
  /** A page that has signed in through the real form and landed on /dashboard. */
  signedInPage: Page;
  /** Another user's car + repair entry — seeded to be leaked, never signed into. */
  foreignUser: ForeignUser;
}

/** Service-role client — seeding and teardown only, never the code under test. */
function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const test = base.extend<AppFixtures>({
  // Timestamp keeps it readable and sortable; the uuid slice keeps parallel
  // workers — and two re-runs inside the same millisecond — from colliding.
  //
  // The empty pattern is required, not stylistic: Playwright reads the
  // destructuring pattern to work out which fixtures this one depends on, and
  // rejects a plain parameter name. This fixture depends on nothing.
  // eslint-disable-next-line no-empty-pattern
  runId: async ({}, use) => {
    await use(`${Date.now().toString()}-${randomUUID().slice(0, 8)}`);
  },

  user: async ({ runId }, use) => {
    const admin = adminClient();
    const email = `e2e-${runId}@carbooklet.test`;
    const password = `E2e-${runId}!`;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip the confirmation link; not what any E2E risk is about
    });
    if (error) throw new Error(`could not seed test user: ${error.message}`);

    await use({ id: data.user.id, email, password });

    // Cleanup. `cars.user_id` and every `entries.*.user_id` are
    // `REFERENCES auth.users(id) ON DELETE CASCADE`, so dropping the user drops
    // everything the test created. Deleting rows by hand would be redundant.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanupError) throw new Error(`could not tear down test user: ${cleanupError.message}`);
  },

  // Seeded through the service-role client on purpose. Every other fixture and
  // helper in this suite writes through the app's own API with the signed-in
  // page's cookies — but this user's rows must exist *without* the browser ever
  // holding their session, which is precisely what no app route will do for us.
  //
  // Bypassing RLS to seed does not weaken the test: RLS is exercised on the
  // READ path, by the app's own anon-key client, which is where the risk lives.
  foreignUser: async ({ runId }, use) => {
    const admin = adminClient();

    const { data, error } = await admin.auth.admin.createUser({
      email: `e2e-foreign-${runId}@carbooklet.test`,
      password: `E2e-foreign-${runId}!`,
      email_confirm: true,
    });
    if (error) throw new Error(`could not seed foreign user: ${error.message}`);
    const id = data.user.id;

    // Unique per run, and distinct from anything the signed-in user creates, so
    // "this string is on the page" can only mean the foreign row leaked.
    const model = `Foreign-${runId}`;
    const description = `foreign-repair-${runId}`;

    const car = await admin
      .from("cars")
      .insert({
        user_id: id,
        brand: "Volvo",
        model,
        production_year: "2019",
        engine_type: "diesel",
        engine_capacity: "2.0L",
        engine_power: "190hp",
      })
      .select("id")
      .single();
    if (car.error) throw new Error(`could not seed foreign car: ${car.error.message}`);

    const repairEntry = await admin
      .from("repair_entries")
      .insert({
        car_id: car.data.id as string,
        user_id: id,
        conducted_at: "2026-02-01",
        mileage: 120000,
        description,
      })
      .select("id")
      .single();
    if (repairEntry.error) throw new Error(`could not seed foreign entry: ${repairEntry.error.message}`);

    await use({
      id,
      car: { id: car.data.id as string, model },
      repairEntry: { id: repairEntry.data.id as string, description },
    });

    // Same cascade as the `user` fixture: dropping the user drops the car and
    // the entry with it.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(id);
    if (cleanupError) throw new Error(`could not tear down foreign user: ${cleanupError.message}`);
  },

  signedInPage: async ({ page, context, user, baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL is not configured");

    // Every accessible name in this app comes from i18n (`t()`), and the locale
    // is read from a `lang` cookie (src/middleware.ts). Pin it, or name-based
    // locators break the day someone's browser carries `lang=pl`.
    await context.addCookies([{ name: "lang", value: "en", url: baseURL }]);

    await page.goto("/auth/signin");

    // `exact: true` is load-bearing. getByLabel matches case-insensitive
    // SUBSTRINGS by default, so a bare "Password" also matches the show/hide
    // toggle's aria-label ("Show password") and fails on strict mode.
    // getByRole("textbox") is not the way out either: <input type="password">
    // has no implicit ARIA role, so no role locator can reach it.
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Wait for the state the app arrives at, never a duration — and wait for
    // the state this fixture actually promises: "signed in".
    //
    // Deliberately NOT waitForURL(). Where sign-in lands is a moving target:
    // /api/auth/signin redirects to `/`, `/` redirects to /dashboard, and
    // /dashboard redirects again to /cars unless a car is selected — which a
    // freshly seeded user never has. Pinning a URL here would couple every
    // signed-in test to the car-selection rules. "Sign out" is rendered only by
    // the authenticated shell, so it means signed-in wherever we landed.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await use(page);
  },
});

export { expect };
