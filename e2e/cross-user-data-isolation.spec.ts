import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

/**
 * RISK: test-plan.md §2 R3 — "Cross-user data access (IDOR): a user reads,
 * edits, or deletes another user's car or entry by id." High × High, and the
 * PRD calls data isolation unconditional.
 *
 * Most of R3 is a route contract and belongs in integration tests (test-plan
 * §2 names integration the cheapest layer; rollout Phase 2 owns it). This test
 * takes the slice integration cannot reach: the two **server-rendered pages**
 * that put another user's data on screen. Neither is an API route, so no
 * handler test covers them.
 *
 * What it protects, and why each half is load-bearing:
 *
 *   1. THE GARAGE. `/cars` renders `getCars(supabase)`
 *      (src/lib/services/cars.ts:5), which selects `cars` with **no user_id
 *      filter at all** — the `Users can view own cars` RLS policy is the single
 *      thing between one user's garage and everyone else's. The research for
 *      this change calls that defense asymmetry the prime R3 regression
 *      target. One dropped policy and every user sees every car.
 *
 *   2. THE DIRECT URL. `/entries/[type]/[id]` is reachable by pasting an id.
 *      It is guarded twice — the `user_id` filter inside `getEntryById` and
 *      the `car_id !== selectedCarId` check — on top of RLS.
 *
 * The risk this test must challenge is the assumption test-plan.md §2 names
 * for R3: "authenticated == authorized". So the browser here is always a
 * *legitimately signed-in* user. Nothing is forged; the whole point is that a
 * valid session is not an entitlement.
 *
 * Conventions come from seed.spec.ts — read that first.
 */

/**
 * The signed-in user needs a car of their own, for two independent reasons —
 * both of which are the difference between this test proving something and
 * proving nothing:
 *
 *   - It is the positive control for the garage assertion. "The foreign car is
 *     absent" is also true of a page that failed to render, redirected, or
 *     showed an empty list. Asserting the user's OWN car is present in the same
 *     breath means absence is isolation, not breakage.
 *   - `/entries/[type]/[id]` redirects to /cars when `selectedCarId` is unset
 *     (the guard at [id].astro:19). A user with no car would sail through this
 *     test on that redirect without the ownership check ever executing.
 *
 * Seeding it through the real API with the page's own cookies follows
 * car-delete-blast-radius.spec.ts: setup is not the thing under test.
 */
async function seedOwnCar(page: Page, model: string): Promise<void> {
  const res = await page.request.post("/api/cars", {
    data: {
      brand: "Toyota",
      model,
      production_year: "2020",
      engine_type: "gas",
      engine_capacity: "1.6L",
      engine_power: "132hp",
    },
  });
  expect(res.status(), `seeding own car ${model} failed: ${await res.text()}`).toBe(201);
}

test.describe("R3 — cross-user data access / IDOR (test-plan.md §2)", () => {
  test("a signed-in user sees none of another user's cars and cannot open their entry by id", async ({
    signedInPage,
    foreignUser,
    runId,
  }) => {
    const page = signedInPage;
    const ownModel = `Owned-${runId}`;

    await seedOwnCar(page, ownModel);

    // --- Assertion 1: the garage is the signed-in user's, and only theirs -----
    await page.goto("/cars");

    const ownCard = page.getByRole("listitem").filter({ hasText: ownModel });
    const foreignCard = page.getByRole("listitem").filter({ hasText: foreignUser.car.model });

    await expect(ownCard).toBeVisible();
    await expect(foreignCard).toHaveCount(0);

    // --- Reach the ownership guard, rather than the "no car selected" exit ----
    await ownCard.getByRole("button", { name: "Select" }).click();
    await expect(ownCard.getByRole("button", { name: "Active" })).toBeVisible();

    // --- Assertion 2: the foreign entry's own URL yields nothing --------------
    //
    // The id is real, the entry exists, and the session is valid. The only
    // reason this must fail is that the row belongs to someone else.
    const response = await page.goto(`/entries/repair/${foreignUser.repairEntry.id}`);

    // Status, not just DOM: [id].astro sets 404 explicitly, and a redirect to
    // /cars would be a 200 — which would mean the guard that fired was the
    // selected-car exit, not ownership.
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Entry not found" })).toBeVisible();

    // The foreign row's text appears nowhere on the page.
    //
    // Bare getByText is the anti-pattern e2e/README.md warns about, because in
    // dev Astro serializes island props into a hidden <code> block. Here that
    // quirk works FOR the assertion instead of against it: EntryDetailEditor is
    // only rendered when `entry` is non-null, so the description reaching those
    // props at all is exactly the leak this line exists to catch. Matching the
    // hidden JSON is a true positive, not a false alarm.
    await expect(page.getByText(foreignUser.repairEntry.description)).toHaveCount(0);

    // No cleanup here: the `user` and `foreignUser` fixtures each delete their
    // user, and ON DELETE CASCADE takes the cars and entries with them.
  });
});
