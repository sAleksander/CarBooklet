import { test, expect, gotoHydrated } from "./fixtures/app";

/**
 * SEED TEST — the exemplar every generated E2E test in this repo should imitate.
 *
 * It is a real test protecting a real risk, but its job is also to demonstrate
 * the conventions. An agent asked to write a new E2E test reads this file first;
 * whatever it sees here, it will copy. The conventions, in order of how often
 * they get violated:
 *
 *   1. LOCATORS: getByRole / getByLabel / getByText — in that order. Never a CSS
 *      selector, never XPath, never DOM structure. If a locator needs
 *      getByTestId, that is a signal the UI is missing an accessible name; fix
 *      the UI first and only reach for a testid when it genuinely cannot carry
 *      one.
 *   2. WAITING: wait for STATE, never for TIME. `expect(...).toBeVisible()` and
 *      `waitForURL()` retry until the app catches up. `waitForTimeout()` is
 *      banned outright — it is slow when it passes and flaky when it fails.
 *   3. TEST DATA: every row this test writes carries a unique suffix (`runId`),
 *      so parallel workers and re-runs cannot collide or assert on each other's
 *      data.
 *   4. CLEANUP: each test owns its setup and its teardown, and leaves the
 *      database as it found it. Here that is the `user` fixture — see
 *      e2e/fixtures/app.ts.
 *   5. NAMING: the describe block names the risk from
 *      context/foundation/test-plan.md that the test protects. A test that
 *      cannot name its risk should not be written.
 *
 * On the AI/OpenRouter boundary (relevant to the R6 test, not this one): E2E
 * runs against the REAL model — no route interception, nothing mocked. See
 * e2e/README.md for the caveat that comes with that.
 */

test.describe("R5 — entry/car CRUD regression (test-plan.md §2)", () => {
  test("a car created through the form is persisted, not just rendered", async ({ signedInPage, runId }) => {
    const page = signedInPage;

    // Unique: two workers running this test at once must not see each other's car.
    const model = `Corolla-${runId}`;

    await gotoHydrated(page, "/cars");

    // Opens the add form. Careful: the list's trigger and the form's submit
    // button share the accessible name "Add car" (cars.addCar vs
    // cars.form.addCar). They are never on screen together — CarList renders the
    // trigger only while the form is closed — so this locator stays
    // unambiguous. It is still a name collision worth fixing in the UI.
    await page.getByRole("button", { name: "Add car" }).click();

    // Wait for the form to actually be open before typing into it — state, not time.
    await expect(page.getByRole("heading", { name: "Add a new car" })).toBeVisible();

    await page.getByLabel("Brand").fill("Toyota");
    await page.getByLabel("Model").fill(model);
    await page.getByLabel("Production year").fill("2020");
    await page.getByLabel("Engine capacity").fill("1.6L");
    await page.getByLabel("Engine power").fill("132hp");
    // Engine type is left at its default ("Gasoline"): fill only what the risk
    // needs. Every extra field is one more thing to break for no coverage.

    await page.getByRole("button", { name: "Add car" }).click();

    const card = page.getByRole("listitem").filter({ hasText: model });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Toyota");

    // Re-read the row through a second, independent path.
    //
    // Verified by deliberate break, not by assumption: stubbing POST /api/cars
    // to report success without inserting fails the assertion above, because
    // CarList refetches GET /api/cars after a save — so that assertion is
    // already server-sourced today, and this reload is redundant *today*.
    //
    // It stays because it is one line and it pins the test's promise
    // ("persisted, not just rendered") to the database rather than to CarList's
    // current choice to refetch. If CarList ever switches to an optimistic
    // update, the assertion above starts passing on client state and this
    // reload — an SSR read via getCars() — becomes the only thing standing
    // between a wiped row and a green suite.
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: model })).toBeVisible();

    // No cleanup here on purpose: the `user` fixture deletes the user, and
    // `cars.user_id ON DELETE CASCADE` takes this car with it.
  });
});
