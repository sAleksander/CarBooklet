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

/**
 * Navigate, then wait until every island on the destination page has hydrated.
 *
 * `page.goto` resolves on load, not on interactive. Astro server-renders each
 * island with an `ssr` attribute and removes it once the component mounts, so
 * "no islands left marked `ssr`" is the app's only honest "this page is
 * interactive now" signal. A CSS locator is correct here despite the role-first
 * rule: this is a framework marker, not application DOM structure, and no
 * accessible equivalent exists.
 *
 * Use this for every in-test navigation. `e2e/README.md` states the rule --
 * never touch an island's controls as the first act after `goto` -- and this is
 * where it is enforced, so the next spec does not have to remember it.
 *
 * The race is neither theoretical nor dev-only. It was invisible for as long as
 * the suite ran against `astro dev`, whose slower responses happened to leave
 * hydration enough time to finish; every spec that clicked after navigating
 * failed the moment the suite moved to a production preview server answering in
 * single-digit milliseconds. The tests were always racing. They were just
 * winning.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 30_000 });
}

export const test = base.extend<AppFixtures>({
  // Start from an EMPTY browser context, discarding the shared signed-in
  // session that playwright.config.ts hands every test in the chromium project.
  //
  // That session belongs to one long-lived user (e2e/auth.setup.ts). Every
  // fixture below seeds and deletes a user of its own, and a test that owns its
  // data must be the only one holding a session — otherwise it opens holding a
  // stranger's token and signs in over the top of it. Nothing today reads the
  // wrong user's rows because of it, but the whole point of the per-test
  // fixtures is that no state survives a test, and an inherited auth cookie is
  // exactly that state.
  //
  // `{ cookies: [], origins: [] }` rather than `undefined`: it is Playwright's
  // documented way to opt a file out of a project-level storageState, and it
  // says "empty" outright instead of relying on how an unset option resolves.
  storageState: { cookies: [], origins: [] },

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
    // Pin the theme too: it changes rendered classes the same way, and keeps
    // runs independent of Chromium's `prefers-color-scheme`.
    await context.addCookies([
      { name: "lang", value: "en", url: baseURL },
      { name: "theme", value: "dark", url: baseURL },
    ]);

    await gotoHydrated(page, "/auth/signin");

    // `exact: true` is load-bearing. getByLabel matches case-insensitive
    // SUBSTRINGS by default, so a bare "Password" also matches the show/hide
    // toggle's aria-label ("Show password") and fails on strict mode.
    // getByRole("textbox") is not the way out either: <input type="password">
    // has no implicit ARIA role, so no role locator can reach it.
    // Wait for the island to HYDRATE before touching the form.
    //
    // SignInForm is `client:load` with controlled inputs. Anything typed before
    // React mounts is written to the DOM and then discarded when the controlled
    // inputs take over with their empty initial state — the form ends up
    // showing "Email is required" over fields that were demonstrably filled a
    // moment earlier. Verifying the typed value does not help: the whole
    // fill-and-check can complete before hydration, and the wipe happens after.
    //
    // The hydration wait itself lives in `gotoHydrated` above.

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
    //
    // The generous timeout is not a disguised sleep — the wait is still on
    // state. It covers a three-hop redirect chain in which the dev server may
    // compile each route on demand, with several workers competing for it. The
    // default 5s is a production-speed budget and fails here for no real reason.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });

    await use(page);
  },
});

export { expect };
