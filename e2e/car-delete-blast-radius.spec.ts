import type { Page } from "@playwright/test";
import { test, expect, gotoHydrated } from "./fixtures/app";

/**
 * RISK: test-plan.md §2 R5 — "Entry/car CRUD regression: edit/delete corrupts
 * or wipes data."
 *
 * Specifically the blast radius of a delete. `DELETE /api/cars/[id]` removes one
 * car, and `entries.*.car_id REFERENCES public.cars(id) ON DELETE CASCADE` makes
 * the database take that car's maintenance history with it. That cascade is
 * correct — and it is also the widest destructive path in the app. Nothing here
 * proves it stops at the car the user actually pointed at.
 *
 * The failure this test exists to catch: a user with two cars deletes one and
 * loses the other's service history. Silent, unrecoverable, and invisible to any
 * test that only ever owns a single car.
 *
 * Why E2E and not integration: the delete crosses auth → the API route → the
 * `getCarById` ownership guard → `deleteCar` → the DB cascade → the
 * `selected_car_id` cookie → an SSR re-read of /entries. The survivor is
 * verified through a server-rendered page, not through client state that
 * CarList happens to be holding.
 *
 * Conventions come from seed.spec.ts — read that first.
 */

interface SeededCar {
  id: string;
  model: string;
}

/**
 * Setup helpers hit the real API with the signed-in page's own cookies. They are
 * not the thing under test — the delete is — so they take the short path rather
 * than driving six form fields twice. Nothing is mocked: these are the same
 * routes, the same auth, and the same RLS the UI goes through.
 */
async function seedCar(page: Page, model: string): Promise<SeededCar> {
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
  expect(res.status(), `seeding car ${model} failed: ${await res.text()}`).toBe(201);
  const { car } = (await res.json()) as { car: { id: string } };
  return { id: car.id, model };
}

/**
 * Repairs, not oil changes, for one reason: repairs are the tab /entries opens
 * on. The survivor's history is then asserted on a server-rendered page with no
 * tab click in between — see the note on hydration in e2e/README.md. The cascade
 * is identical across all four entry tables (`car_id REFERENCES public.cars(id)
 * ON DELETE CASCADE`), so nothing about the risk is lost.
 */
async function seedRepair(page: Page, carId: string, description: string): Promise<void> {
  const res = await page.request.post("/api/entries/repair", {
    data: {
      car_id: carId,
      conducted_at: "2026-01-15",
      mileage: 85000,
      description,
    },
  });
  expect(res.status(), `seeding entry for car ${carId} failed: ${await res.text()}`).toBe(201);
}

test.describe("R5 — entry/car CRUD regression (test-plan.md §2)", () => {
  test("deleting one car leaves the other car's service history intact", async ({ signedInPage, runId }) => {
    const page = signedInPage;

    // Unique per run: parallel workers and re-runs must not read each other's rows.
    const doomedModel = `Doomed-${runId}`;
    const keeperModel = `Keeper-${runId}`;
    const keeperRepair = `keeper-repair-${runId}`;

    // --- Setup: two cars, each carrying one repair entry ----------------------
    const doomed = await seedCar(page, doomedModel);
    const keeper = await seedCar(page, keeperModel);
    await seedRepair(page, doomed.id, `doomed-repair-${runId}`);
    await seedRepair(page, keeper.id, keeperRepair);

    await gotoHydrated(page, "/cars");

    const doomedCard = page.getByRole("listitem").filter({ hasText: doomedModel });
    const keeperCard = page.getByRole("listitem").filter({ hasText: keeperModel });

    // Make the doomed car the *selected* one before deleting it. That is the
    // harder path on purpose: DELETE /api/cars/[id] also clears the
    // `selected_car_id` cookie when it matches, so this exercises the branch
    // where the delete mutates session state as well as rows.
    await doomedCard.getByRole("button", { name: "Select" }).click();
    await expect(doomedCard.getByRole("button", { name: "Active" })).toBeVisible();

    // --- Action: delete the doomed car through the real UI --------------------
    await doomedCard.getByRole("button", { name: "Delete" }).click();

    // The confirm dialog's action button and every card's delete button share the
    // accessible name "Delete" (both are `common.delete`). Radix marks the rest
    // of the page aria-hidden while the modal is open, so a bare locator would
    // *probably* resolve — scoping to the dialog makes it certain rather than
    // dependent on that behavior.
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete" }).click();

    // --- Assertion 1: exactly one car died ------------------------------------
    await expect(doomedCard).toHaveCount(0);
    await expect(keeperCard).toBeVisible();

    // --- Assertion 2: the survivor's history survived, read back from the server
    //
    // This is the assertion the test exists for. /entries is server-rendered:
    // entries.astro fetches through getOilChangeEntries() during SSR, so what it
    // shows is the database, not anything CarList is still holding in React state.
    await keeperCard.getByRole("button", { name: "Select" }).click();
    await expect(keeperCard.getByRole("button", { name: "Active" })).toBeVisible();

    await gotoHydrated(page, "/entries");
    await expect(page.getByRole("heading", { name: `Toyota ${keeperModel}` })).toBeVisible();

    // Locate the entry by its LINK, not by text. In dev, Astro serializes every
    // island's props into a hidden `<code>` block, so a bare
    // getByText(keeperRepair) matches that JSON blob — which is present whether
    // or not the entry actually rendered, and would keep this test green through
    // exactly the data loss it exists to catch.
    await expect(page.getByRole("link").filter({ hasText: keeperRepair })).toBeVisible();

    // No cleanup here: the `user` fixture deletes the user, and
    // `cars.user_id ON DELETE CASCADE` takes both cars and every entry with it.
  });
});
