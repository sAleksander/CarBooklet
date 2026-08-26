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
 * matches zero rows. That is not an error at the SQL level; whether it reaches
 * the caller as one depends entirely on the tail of the service wrapper:
 *
 * | service     | tail                    | what B observes today       |
 * | ----------- | ----------------------- | --------------------------- |
 * | `updateCar` | `.select().single()`    | **throws** (`PGRST116`)     |
 * | `deleteCar` | bare `.delete()`        | **nothing** — silent `void` |
 * | `createCar` | INSERT `WITH CHECK`     | **throws** (`42501`)        |
 *
 * Three signatures, one guarantee. A test written as "expect it to throw" would
 * pass today for `updateCar`, pass for `createCar`, and pass *forever* for
 * `deleteCar` — including on the day isolation breaks, because a successful
 * cross-user delete is equally silent. So the load-bearing assertion in every
 * destructive case is a read-back as A: the row is byte-identical, or still there.
 *
 * ## Why each case is asserted twice
 *
 * `updateCar`/`deleteCar` carry no `user_id` filter of their own (`cars.ts:25,31`),
 * so today the service path reaches RLS and the policy is what rejects B. That is
 * not guaranteed to stay true: `context/changes/swallowed-error-propagation/`
 * plans to add the filter as defense in depth, which would make the service
 * short-circuit *ahead* of RLS. These tests would still pass — and would silently
 * stop testing the policy layer, which is the exact false-pass this suite exists
 * to prevent.
 *
 * So each cross-user mutation is asserted twice: once through the service
 * function (the contract the app depends on, stable under either service shape),
 * and once through a raw PostgREST call carrying B's JWT that bypasses the
 * service layer entirely (the policy itself, pinned independently of anything
 * `services/cars.ts` ever does). The raw half is what keeps this file honest.
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
    it("throws for B and leaves A's car byte-identical", async () => {
      const before = await readAsOwner();

      // `.single()` over zero visible rows — PGRST116 surfaces as a throw.
      await expect(updateCar(users.userB.client, carA.id, { brand: marker("HACKED") })).rejects.toThrow();

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
    it("is silent for B and leaves A's car in place", async () => {
      const before = await readAsOwner();

      // Note the asymmetry with update: no `.select()` tail, so this resolves
      // without complaint. If the read-back below were dropped in favour of
      // `.rejects.toThrow()`, the test would invert — and a real isolation
      // break would read as a pass.
      await expect(deleteCar(users.userB.client, carA.id)).resolves.toBeUndefined();

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
      await expect(deleteCar(users.userB.client, carB.id)).resolves.toBeUndefined();

      // Without this, "A's car survived B's delete" is satisfied just as well by
      // a delete that never works for anyone.
      expect(await getCarById(users.userB.client, carB.id, users.userB.id)).toBeNull();
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
