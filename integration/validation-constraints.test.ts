import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createCar } from "@/lib/services/cars";
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
} from "@/lib/services/entries";
import { withTwoUsers, type TwoUsers, type TestClient } from "./fixtures/users";
import { seedCar, marker, validEntryPayload, ENTRY_TABLES } from "./fixtures/seed";
import type { Car, EngineType, EntryType } from "@/types";

/**
 * R5, the independent oracle: what the database refuses, regardless of what any
 * handler believes.
 *
 * The risk this answers is "client-side zod equals server-side enforcement" —
 * an assumption that is false here in both directions, and the reason this file
 * asserts against constraints rather than against schemas. A test whose expected
 * value is copied from the handler under test proves only that the handler
 * agrees with itself. These expectations come from
 * `20260528000001_entries_mileage_check.sql` and the `engine_type` enum in
 * `20260527000000_cars_schema.sql` — written before any of this code, and
 * enforced below every path into the table.
 *
 * ## `mileage: null` is accepted, and that is deliberate
 *
 * `CHECK (mileage > 0)` passes on NULL — SQL three-valued logic means the
 * constraint is not violated, merely unknown. Mileage genuinely is optional
 * (`mileage?: number | null` in every form type, and every entry form ships it
 * empty), so the null case below asserts **acceptance**. Anyone "tightening"
 * that assertion to a rejection would be contradicting the forms, and the
 * comment is here so that shows up in review rather than in production.
 *
 * ## Codes, not message text
 *
 * Service functions throw `new Error(res.error.message)` and discard
 * `res.error.code`, so the service-path assertions can only say "it rejected".
 * The raw-path assertions carry the code — `23514` check violation, `22P02`
 * invalid enum input — which is stable across Postgres versions in a way the
 * message text is not.
 */

interface ConstraintCase {
  label: string;
  type: EntryType;
  create(client: TestClient, userId: string, carId: string, mileage: number | null): Promise<{ id: string }>;
  update(client: TestClient, entryId: string, userId: string, mileage: number | null): Promise<unknown>;
}

const CASES: ConstraintCase[] = [
  {
    label: "repair",
    type: "repair",
    create: (client, userId, carId, mileage) =>
      createRepairEntry(client, userId, carId, {
        conducted_at: "2026-07-01",
        mileage,
        description: marker("constraint"),
        cause: null,
      }),
    update: (client, entryId, userId, mileage) =>
      updateRepairEntry(client, entryId, userId, {
        conducted_at: "2026-07-01",
        mileage,
        description: marker("constraint"),
        cause: null,
      }),
  },
  {
    label: "oil_change",
    type: "oil_change",
    create: (client, userId, carId, mileage) =>
      createOilChangeEntry(client, userId, carId, {
        conducted_at: "2026-07-02",
        mileage,
        oil_details: marker("constraint"),
      }),
    update: (client, entryId, userId, mileage) =>
      updateOilChangeEntry(client, entryId, userId, {
        conducted_at: "2026-07-02",
        mileage,
        oil_details: marker("constraint"),
      }),
  },
  {
    label: "inspection",
    type: "inspection",
    create: (client, userId, carId, mileage) =>
      createInspectionEntry(client, userId, carId, {
        conducted_at: "2026-07-03",
        mileage,
        result: "Passed",
        next_inspection_date: "2027-07-03",
      }),
    update: (client, entryId, userId, mileage) =>
      updateInspectionEntry(client, entryId, userId, {
        conducted_at: "2026-07-03",
        mileage,
        result: "Passed",
        next_inspection_date: "2027-07-03",
      }),
  },
  {
    label: "insurance",
    type: "insurance",
    create: (client, userId, carId, mileage) =>
      createInsuranceEntry(client, userId, carId, {
        conducted_at: "2026-07-04",
        mileage,
        insurer: marker("constraint"),
        policy_start_date: "2026-07-04",
        renewal_date: "2027-07-04",
      }),
    update: (client, entryId, userId, mileage) =>
      updateInsuranceEntry(client, entryId, userId, {
        conducted_at: "2026-07-04",
        mileage,
        insurer: marker("constraint"),
        policy_start_date: "2026-07-04",
        renewal_date: "2027-07-04",
      }),
  },
];

describe("R5 · validation constraints · the database as oracle", () => {
  let users: TwoUsers;
  let owner: TwoUsers["userA"];
  let car: Car;

  beforeAll(async () => {
    users = await withTwoUsers();
    owner = users.userA;
  });

  afterAll(async () => {
    await users.dispose();
  });

  beforeEach(async () => {
    car = await seedCar(owner.client, owner.id);
  });

  describe.each(CASES)("$label", (entry) => {
    it("rejects mileage 0", async () => {
      // Note what this means for the edge: every route's zod schema currently
      // says `.min(0)`, so this exact value passes validation and arrives here.
      // Phase 5 closes that gap on the schema side; the constraint is what
      // stands until then, and what this test pins.
      await expect(entry.create(owner.client, owner.id, car.id, 0)).rejects.toThrow();
    });

    it("rejects mileage 0 with a check-violation code on a raw insert", async () => {
      const raw = await owner.client.from(ENTRY_TABLES[entry.type]).insert({
        user_id: owner.id,
        car_id: car.id,
        ...validEntryPayload(entry.type),
        mileage: 0,
      });

      expect(raw.error?.code).toBe("23514");
    });

    it("rejects negative mileage", async () => {
      await expect(entry.create(owner.client, owner.id, car.id, -1)).rejects.toThrow();
    });

    it("accepts mileage null and stores it as null", async () => {
      // Intended: `CHECK (mileage > 0)` is not violated by NULL, and the forms
      // ship mileage empty. Do not "fix" this into a rejection.
      const created = await entry.create(owner.client, owner.id, car.id, null);

      const readBack = await getEntryById(owner.client, entry.type, created.id, owner.id);
      expect(readBack?.mileage).toBeNull();
    });

    it("rejects mileage 0 on update, not just on insert", async () => {
      const created = await entry.create(owner.client, owner.id, car.id, 170_000);

      await expect(entry.update(owner.client, created.id, owner.id, 0)).rejects.toThrow();

      // The constraint gates every write, so the original value survives.
      const readBack = await getEntryById(owner.client, entry.type, created.id, owner.id);
      expect(readBack?.mileage).toBe(170_000);
    });
  });

  describe("cars", () => {
    it("rejects an out-of-enum engine_type", async () => {
      // The cast is the point: `engine_type` is a Postgres enum, and nothing
      // between the client and the column narrows it at runtime. TypeScript is
      // not a server-side control.
      await expect(
        createCar(owner.client, {
          user_id: owner.id,
          brand: "Volvo",
          model: marker("bad-engine"),
          production_year: "2019",
          engine_type: "steam" as EngineType,
          engine_capacity: "2.0L",
          engine_power: "190hp",
        }),
      ).rejects.toThrow();
    });

    it("rejects an out-of-enum engine_type with an invalid-input code on a raw insert", async () => {
      const raw = await owner.client.from("cars").insert({
        user_id: owner.id,
        brand: "Volvo",
        model: marker("bad-engine-raw"),
        production_year: "2019",
        engine_type: "steam",
        engine_capacity: "2.0L",
        engine_power: "190hp",
      });

      expect(raw.error?.code).toBe("22P02");
    });

    it("accepts every value the enum does declare", async () => {
      // The pair. "steam is rejected" would also hold for a column that rejects
      // everything, or a client that cannot write at all.
      const declared: EngineType[] = ["electric", "gas", "diesel", "lpg"];

      for (const engineType of declared) {
        const created = await createCar(owner.client, {
          user_id: owner.id,
          brand: "Volvo",
          model: marker(`engine-${engineType}`),
          production_year: "2019",
          engine_type: engineType,
          engine_capacity: "2.0L",
          engine_power: "190hp",
        });
        expect(created.engine_type).toBe(engineType);
      }
    });
  });
});
