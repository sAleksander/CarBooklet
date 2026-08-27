import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { getCars, getCarById, createCar, updateCar, deleteCar } from "@/lib/services/cars";
import { withTwoUsers, type TwoUsers } from "./fixtures/users";
import { seedCar, marker } from "./fixtures/seed";
import type { Car } from "@/types";

/**
 * R3, cars half: every read, update, delete and impersonating insert that User B
 * attempts against User A's car fails — adjudicated by real RLS.
 *
 * ## Why every destructive case asserts persisted state, not an exception
 *
 * Under an RLS `USING` clause, an UPDATE or DELETE against a row you cannot see
 * matches zero rows. That is not an error at the SQL level, and how it reaches
 * the caller depends entirely on the tail of the service wrapper — which has
 * changed once already:
 *
 * | service     | tail                        | what B observes           |
 * | ----------- | --------------------------- | ------------------------- |
 * | `updateCar` | `.select().maybeSingle()`   | `null`  (was: a throw)    |
 * | `deleteCar` | `.delete().select("id")`    | `false` (was: silent void)|
 * | `createCar` | INSERT `WITH CHECK`         | **throws** (`42501`)      |
 *
 * Three signatures, one guarantee. A test written as "expect it to throw" would
 * have passed for `createCar`, passed for `updateCar` under its old tail, and
 * passed *forever* for `deleteCar` — including on the day isolation broke,
 * because a successful cross-user delete was equally silent. So the load-bearing
 * assertion in every destructive case is a read-back as A: the row is
 * byte-identical, or still there.
 *
 * The destructive cases below therefore assert nothing at all about what the
 * service returns. That is not an oversight — it is what stops a service reshape
 * from breaking an isolation test that is not about the service's shape. The
 * return contract is pinned separately, in "reports whether it actually deleted
 * anything", where a break means the contract changed rather than the policy.
 *
 * ## Why each case is asserted twice
 *
 * `updateCar`/`deleteCar` now carry `.eq("user_id", userId)` of their own, added
 * by `swallowed-error-propagation` as defense in depth. That means the service
 * path short-circuits *ahead* of RLS: these tests would pass even if every policy
 * were dropped, which is the exact false-pass this suite exists to prevent.
 *
 * This was anticipated. Each cross-user mutation is asserted twice: once through
 * the service function (the contract the app depends on, stable under either
 * service shape), and once through a raw PostgREST call carrying B's JWT that
 * bypasses the service layer entirely (the policy itself, pinned independently of
 * anything `services/cars.ts` ever does). The raw half is what keeps this file
 * honest — and now that the filter is in place, it is the *only* half still
 * reaching the policy. Do not delete a raw case because its service sibling
 * covers it; the sibling no longer does.
 */
describe("R3 · cross-user isolation · cars", () => {
  let users: TwoUsers;
  let carA: Car;
  let carB: Car;

  beforeAll(async () => {
    // Per-file, not per-test: `config.toml` caps sign-ins at 30 / 5 min and this
    // spends two of them. Tests stay independent by seeding their own cars.
    users = await withTwoUsers();
  });

  afterAll(async () => {
    // `users` is typed non-nullable for the benefit of the hundreds of use
    // sites above, but it is genuinely unassigned when `beforeAll` throws —
    // and an unguarded TypeError here would bury that original failure.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    await users?.dispose();
  });

  beforeEach(async () => {
    // A fresh car per test, so a destructive case cannot leak into the next one.
    carA = await seedCar(users.userA.client, users.userA.id);
    carB = await seedCar(users.userB.client, users.userB.id);
  });

  /** Ground truth through the owner's own client — never through the admin one. */
  async function readAsOwner(): Promise<Car | null> {
    return getCarById(users.userA.client, carA.id, users.userA.id);
  }

  describe("read", () => {
    it("omits A's car from B's list, and still returns B's own", async () => {
      const seenByB = (await getCars(users.userB.client)).map((car) => car.id);

      // The pair. Absence alone would also hold for a client that reads nothing.
      expect(seenByB).not.toContain(carA.id);
      expect(seenByB).toContain(carB.id);
    });

    it("returns null when B fetches A's car by id", async () => {
      expect(await getCarById(users.userB.client, carA.id, users.userB.id)).toBeNull();
      // Positive control: the same call shape works for B's own car.
      expect(await getCarById(users.userB.client, carB.id, users.userB.id)).not.toBeNull();
    });

    it("returns null even when B supplies A's user id", async () => {
      // The service's `.eq("user_id", userId)` filter cannot help here — B is
      // asking for exactly the row that filter would allow. Only RLS refuses,
      // which is the point: this is the assertion that reaches the policy.
      expect(await getCarById(users.userB.client, carA.id, users.userA.id)).toBeNull();
    });

    it("hides A's car from a raw select carrying B's JWT", async () => {
      const raw = await users.userB.client.from("cars").select("*").eq("id", carA.id);

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("does not modify A's car when B updates it", async () => {
      const before = await readAsOwner();

      // Deliberately unasserted: what `updateCar` *returns* here. It has been a
      // throw and it is now `null`, and it could reasonably become either again.
      // The read-back below is the guarantee; the return value is an artefact of
      // the wrapper's tail. Pinning it here is what made this file break when the
      // service was reshaped.
      await updateCar(users.userB.client, carA.id, users.userB.id, { brand: marker("HACKED") });

      expect(await readAsOwner()).toEqual(before);
    });

    it("matches zero rows on a raw update carrying B's JWT", async () => {
      const before = await readAsOwner();

      const raw = await users.userB.client
        .from("cars")
        .update({ brand: marker("HACKED") })
        .eq("id", carA.id)
        .select();

      // No error — RLS `USING` makes the row invisible, so the statement is a
      // well-formed no-op. Zero affected rows is the whole signal.
      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
      expect(await readAsOwner()).toEqual(before);
    });
  });

  describe("delete", () => {
    it("leaves A's car in place when B deletes it", async () => {
      const before = await readAsOwner();

      await deleteCar(users.userB.client, carA.id, users.userB.id);

      // The load-bearing assertion, for the same reason as update: a delete that
      // silently did nothing and a delete that silently succeeded are the same
      // return value. Only the row can tell them apart.
      expect(await readAsOwner()).toEqual(before);
    });

    it("matches zero rows on a raw delete carrying B's JWT", async () => {
      const before = await readAsOwner();

      const raw = await users.userB.client.from("cars").delete().eq("id", carA.id).select("id");

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
      expect(await readAsOwner()).toEqual(before);
    });

    it("leaves B's own car deletable — the delete path itself works", async () => {
      await deleteCar(users.userB.client, carB.id, users.userB.id);

      // Without this, "A's car survived B's delete" is satisfied just as well by
      // a delete that never works for anyone.
      expect(await getCarById(users.userB.client, carB.id, users.userB.id)).toBeNull();
    });

    it("reports whether it actually deleted anything", async () => {
      // The one case that is *about* the return value, kept separate from the
      // isolation assertions above so that reshaping the service breaks this
      // test — where the contract lives — and not those.
      //
      // Before `.select("id")` was added, both of these were `undefined`: a
      // refused cross-user delete and a successful one were indistinguishable to
      // every caller. That is the zero-row DELETE bug, and this is its oracle.
      expect(await deleteCar(users.userB.client, carA.id, users.userB.id)).toBe(false);
      expect(await deleteCar(users.userB.client, carB.id, users.userB.id)).toBe(true);
    });
  });

  describe("impersonating insert", () => {
    it("rejects a car B writes under A's user id", async () => {
      const impersonated = marker("impersonated");

      // INSERT is the one operation that genuinely raises: a `WITH CHECK`
      // violation is Postgres 42501, not a silent zero-row no-op.
      await expect(
        createCar(users.userB.client, {
          user_id: users.userA.id,
          brand: "Volvo",
          model: impersonated,
          production_year: "2019",
          engine_type: "diesel",
          engine_capacity: "2.0L",
          engine_power: "190hp",
        }),
      ).rejects.toThrow();

      // The rejection is only half of it: nothing carrying that marker may have
      // landed in A's garage. The unique model string is what makes "this row
      // leaked" a fact rather than a guess about which fixture wrote what.
      const modelsSeenByA = (await getCars(users.userA.client)).map((car) => car.model);
      expect(modelsSeenByA).not.toContain(impersonated);
    });

    it("rejects a raw insert carrying B's JWT under A's user id", async () => {
      const raw = await users.userB.client.from("cars").insert({
        user_id: users.userA.id,
        brand: "Volvo",
        model: marker("impersonated-raw"),
        production_year: "2019",
        engine_type: "diesel",
        engine_capacity: "2.0L",
        engine_power: "190hp",
      });

      expect(raw.error).not.toBeNull();
      expect(raw.error?.code).toBe("42501");
    });
  });
});
