import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { getCarById, createCar, updateCar, deleteCar } from "@/lib/services/cars";
import {
  getEntryById,
  createRepairEntry,
  createOilChangeEntry,
  createInspectionEntry,
  createInsuranceEntry,
  updateRepairEntry,
  updateOilChangeEntry,
  updateInspectionEntry,
  updateInsuranceEntry,
  deleteRepairEntry,
  deleteOilChangeEntry,
  deleteInspectionEntry,
  deleteInsuranceEntry,
} from "@/lib/services/entries";
import { withOneUser, type OneUser, type TestClient } from "./fixtures/users";
import { seedCar, seedEntry, marker } from "./fixtures/seed";
import type { Car, Entry, EntryType } from "@/types";

/**
 * R5, owner path: create / update / delete actually persist.
 *
 * ## The oracle rule
 *
 * Every assertion here re-reads the row from the database and compares it to
 * the **payload the test sent**, never to the value the function under test
 * returned. Those are two different claims. `createRepairEntry` hands back
 * whatever PostgREST echoed, so asserting on its return value proves the
 * function can quote itself — it would keep passing if the row were rolled back
 * a millisecond later, or written to the wrong table. The fixture is the oracle;
 * the round-trip is the test.
 *
 * (E2E's `seed.spec.ts` already makes this argument at the browser level for
 * cars — "persisted, not just rendered". This is the same claim one layer down,
 * extended to all four entry types.)
 *
 * ## Sibling rows
 *
 * Deletes assert two things: the target is gone, and its siblings are not. A
 * delete with a broken filter takes more than it was asked to, and "the row I
 * deleted is gone" cannot tell the difference.
 */

interface EntryCase {
  label: string;
  type: EntryType;
  create(client: TestClient, userId: string, carId: string, mark: string): Promise<{ id: string }>;
  update(client: TestClient, entryId: string, userId: string, mark: string): Promise<unknown>;
  remove(client: TestClient, entryId: string, userId: string): Promise<boolean>;
  /** Field values the create payload commits to, checked on read-back. */
  createdFields(mark: string): Record<string, unknown>;
  updatedFields(mark: string): Record<string, unknown>;
}

const ENTRY_CASES: EntryCase[] = [
  {
    label: "repair",
    type: "repair",
    create: (client, userId, carId, mark) =>
      createRepairEntry(client, userId, carId, {
        conducted_at: "2026-05-01",
        mileage: 160_000,
        description: mark,
        cause: "wear",
      }),
    update: (client, entryId, userId, mark) =>
      updateRepairEntry(client, entryId, userId, {
        conducted_at: "2026-06-01",
        mileage: 161_000,
        description: mark,
        cause: "wear",
      }),
    remove: deleteRepairEntry,
    createdFields: (mark) => ({ conducted_at: "2026-05-01", mileage: 160_000, description: mark, cause: "wear" }),
    updatedFields: (mark) => ({ conducted_at: "2026-06-01", mileage: 161_000, description: mark, cause: "wear" }),
  },
  {
    label: "oil_change",
    type: "oil_change",
    create: (client, userId, carId, mark) =>
      createOilChangeEntry(client, userId, carId, {
        conducted_at: "2026-05-02",
        mileage: 162_000,
        oil_details: mark,
      }),
    update: (client, entryId, userId, mark) =>
      updateOilChangeEntry(client, entryId, userId, {
        conducted_at: "2026-06-02",
        mileage: 163_000,
        oil_details: mark,
      }),
    remove: deleteOilChangeEntry,
    createdFields: (mark) => ({ conducted_at: "2026-05-02", mileage: 162_000, oil_details: mark }),
    updatedFields: (mark) => ({ conducted_at: "2026-06-02", mileage: 163_000, oil_details: mark }),
  },
  {
    label: "inspection",
    type: "inspection",
    create: (client, userId, carId) =>
      createInspectionEntry(client, userId, carId, {
        conducted_at: "2026-05-03",
        mileage: 164_000,
        result: "Passed",
        next_inspection_date: "2027-05-03",
      }),
    update: (client, entryId, userId) =>
      updateInspectionEntry(client, entryId, userId, {
        conducted_at: "2026-06-03",
        mileage: 165_000,
        result: "Failed",
        next_inspection_date: "2028-06-03",
      }),
    remove: deleteInspectionEntry,
    createdFields: () => ({
      conducted_at: "2026-05-03",
      mileage: 164_000,
      result: "Passed",
      next_inspection_date: "2027-05-03",
    }),
    updatedFields: () => ({
      conducted_at: "2026-06-03",
      mileage: 165_000,
      result: "Failed",
      next_inspection_date: "2028-06-03",
    }),
  },
  {
    label: "insurance",
    type: "insurance",
    create: (client, userId, carId, mark) =>
      createInsuranceEntry(client, userId, carId, {
        conducted_at: "2026-05-04",
        mileage: 166_000,
        insurer: mark,
        policy_start_date: "2026-05-04",
        renewal_date: "2027-05-04",
      }),
    update: (client, entryId, userId, mark) =>
      updateInsuranceEntry(client, entryId, userId, {
        conducted_at: "2026-06-04",
        mileage: 167_000,
        insurer: mark,
        policy_start_date: "2026-06-04",
        renewal_date: "2028-06-04",
      }),
    remove: deleteInsuranceEntry,
    createdFields: (mark) => ({
      conducted_at: "2026-05-04",
      mileage: 166_000,
      insurer: mark,
      policy_start_date: "2026-05-04",
      renewal_date: "2027-05-04",
    }),
    updatedFields: (mark) => ({
      conducted_at: "2026-06-04",
      mileage: 167_000,
      insurer: mark,
      policy_start_date: "2026-06-04",
      renewal_date: "2028-06-04",
    }),
  },
];

describe("R5 · CRUD integrity · owner path", () => {
  let users: OneUser;
  let owner: OneUser["user"];

  beforeAll(async () => {
    // One user, not two: every assertion in this file is about what the owner
    // can do to their own rows. See `withOneUser`'s note on the sign-in budget.
    users = await withOneUser();
    owner = users.user;
  });

  afterAll(async () => {
    // `users` is typed non-nullable for the benefit of the hundreds of use
    // sites above, but it is genuinely unassigned when `beforeAll` throws —
    // and an unguarded TypeError here would bury that original failure.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    await users?.dispose();
  });

  describe("cars", () => {
    it("persists a created car, read back by id", async () => {
      const model = marker("crud-car");
      const created = await createCar(owner.client, {
        user_id: owner.id,
        brand: "Saab",
        model,
        production_year: "2004",
        engine_type: "gas",
        engine_capacity: "2.3L",
        engine_power: "220hp",
      });

      // Oracle is the payload above, not `created`.
      const readBack = await getCarById(owner.client, created.id, owner.id);
      expect(readBack).toMatchObject({
        brand: "Saab",
        model,
        production_year: "2004",
        engine_type: "gas",
        engine_capacity: "2.3L",
        engine_power: "220hp",
        user_id: owner.id,
      });
    });

    it("persists an update and touches nothing else", async () => {
      const car = await seedCar(owner.client, owner.id);
      const before = await getCarById(owner.client, car.id, owner.id);
      const newModel = marker("renamed");

      await updateCar(owner.client, car.id, owner.id, { model: newModel });

      const after = await getCarById(owner.client, car.id, owner.id);
      expect(after?.model).toBe(newModel);
      // Everything the update did not name is unchanged. `updated_at` is
      // excluded deliberately — a trigger owns it, and asserting it stayed put
      // would be asserting the trigger is broken.
      expect({ ...after, model: null, updated_at: null }).toEqual({ ...before, model: null, updated_at: null });
    });

    it("removes a deleted car and leaves its siblings alone", async () => {
      const doomed = await seedCar(owner.client, owner.id);
      const sibling = await seedCar(owner.client, owner.id);

      await deleteCar(owner.client, doomed.id, owner.id);

      expect(await getCarById(owner.client, doomed.id, owner.id)).toBeNull();
      // A delete with a broken filter takes more than it was asked for, and
      // "the row I deleted is gone" cannot tell the difference.
      expect(await getCarById(owner.client, sibling.id, owner.id)).not.toBeNull();
    });
  });

  describe.each(ENTRY_CASES)("$label", (entry) => {
    let car: Car;

    beforeEach(async () => {
      car = await seedCar(owner.client, owner.id);
    });

    /** Read-back through the app's own path, as the owner. */
    async function read(entryId: string): Promise<Entry | null> {
      return getEntryById(owner.client, entry.type, entryId, owner.id);
    }

    it("persists a created entry, read back by id", async () => {
      const mark = marker("crud");
      const created = await entry.create(owner.client, owner.id, car.id, mark);

      const readBack = await read(created.id);
      expect(readBack).toMatchObject({
        ...entry.createdFields(mark),
        car_id: car.id,
        user_id: owner.id,
      });
    });

    it("persists an update, leaving car_id and user_id alone", async () => {
      const created = await entry.create(owner.client, owner.id, car.id, marker("before"));
      const mark = marker("after");

      await entry.update(owner.client, created.id, owner.id, mark);

      const readBack = await read(created.id);
      expect(readBack).toMatchObject({
        ...entry.updatedFields(mark),
        // Ownership columns are not part of the update payload and must survive
        // it. A handler that rebuilt the row from scratch would fail here.
        car_id: car.id,
        user_id: owner.id,
      });
    });

    it("removes a deleted entry and leaves its siblings alone", async () => {
      const doomed = await entry.create(owner.client, owner.id, car.id, marker("doomed"));
      const sibling = await entry.create(owner.client, owner.id, car.id, marker("sibling"));

      await expect(entry.remove(owner.client, doomed.id, owner.id)).resolves.toBe(true);

      expect(await read(doomed.id)).toBeNull();
      expect(await read(sibling.id)).not.toBeNull();
    });

    it("leaves the other three entry types untouched by a delete", async () => {
      const doomed = await entry.create(owner.client, owner.id, car.id, marker("doomed"));
      const others = await Promise.all(
        ENTRY_CASES.filter((other) => other.type !== entry.type).map(async (other) => ({
          type: other.type,
          row: await seedEntry(owner.client, other.type, { userId: owner.id, carId: car.id }),
        })),
      );

      await entry.remove(owner.client, doomed.id, owner.id);

      // Same car, different tables. Deleting a repair must not disturb the oil
      // change sitting beside it.
      for (const other of others) {
        expect(await getEntryById(owner.client, other.type, other.row.id, owner.id)).not.toBeNull();
      }
    });
  });
});
