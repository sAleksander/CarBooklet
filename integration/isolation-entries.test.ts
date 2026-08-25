import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  getRepairEntries,
  getOilChangeEntries,
  getInspectionEntries,
  getInsuranceEntries,
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
  getCarDeadlines,
  getLastEntry,
} from "@/lib/services/entries";
import { withTwoUsers, type TwoUsers, type TestClient } from "./fixtures/users";
import { seedCar, seedEntry, marker, validEntryPayload, ENTRY_TABLES, type SeededEntry } from "./fixtures/seed";
import type { Car, Entry, EntryType } from "@/types";

/**
 * R3, entries half: the same matrix as `isolation-cars.test.ts`, driven once per
 * entry type instead of written out four times.
 *
 * The four types share an identical query shape — same columns, same policies,
 * same service wrappers modulo the table name — so a `describe.each` table is the
 * honest encoding. Four hand-copied files would drift, and the drift would land
 * in whichever type someone forgot to update.
 *
 * Two things differ from the cars file, both worth knowing before reading on:
 *
 * 1. **Entry services already filter `user_id` themselves** (every read, update
 *    and delete in `services/entries.ts` chains `.eq("id").eq("user_id")`). So
 *    the service-path assertions here are satisfied by the filter alone and never
 *    reach a policy. The raw-client assertions are therefore not a nice-to-have
 *    on this side — they are the *only* thing pinning entry RLS.
 * 2. **The delete signature differs again.** Entry deletes end in `.select("id")`
 *    and map `[]` to `false`, so a cross-user delete is neither a throw (cars'
 *    `updateCar`) nor silent (cars' `deleteCar`) but a falsy return. Third
 *    signature, same guarantee — and the read-back is still what carries it.
 *
 * Cross-*car* inserts (B writing an entry under B's own id but against A's car)
 * are deliberately absent here: that gap is real at the database today, and
 * Phase 3 owns writing it red-first before the policy migration closes it.
 */

interface EntryCase {
  label: string;
  type: EntryType;
  /** Lists a car's entries of this type, as the given user. */
  list(client: TestClient, carId: string, userId: string): Promise<{ id: string }[]>;
  /** Applies a full-payload update whose marker makes any mutation visible. */
  update(client: TestClient, entryId: string, userId: string, mark: string): Promise<unknown>;
  remove(client: TestClient, entryId: string, userId: string): Promise<boolean>;
  /** Creates an entry attributed to `userId` on `carId`. */
  create(client: TestClient, userId: string, carId: string, mark: string): Promise<{ id: string }>;
}

const ENTRY_CASES: EntryCase[] = [
  {
    label: "repair",
    type: "repair",
    list: getRepairEntries,
    update: (client, entryId, userId, mark) =>
      updateRepairEntry(client, entryId, userId, {
        conducted_at: "2026-03-01",
        mileage: 130_000,
        description: mark,
        cause: null,
      }),
    remove: deleteRepairEntry,
    create: (client, userId, carId, mark) =>
      createRepairEntry(client, userId, carId, {
        conducted_at: "2026-03-01",
        mileage: 130_000,
        description: mark,
        cause: null,
      }),
  },
  {
    label: "oil_change",
    type: "oil_change",
    list: getOilChangeEntries,
    update: (client, entryId, userId, mark) =>
      updateOilChangeEntry(client, entryId, userId, {
        conducted_at: "2026-03-02",
        mileage: 131_000,
        oil_details: mark,
      }),
    remove: deleteOilChangeEntry,
    create: (client, userId, carId, mark) =>
      createOilChangeEntry(client, userId, carId, {
        conducted_at: "2026-03-02",
        mileage: 131_000,
        oil_details: mark,
      }),
  },
  {
    label: "inspection",
    type: "inspection",
    list: getInspectionEntries,
    // No free-text column to carry the marker, so the mutation is the enum flip
    // "Passed" (seeded) → "Failed". The read-back is `toEqual` on the whole row,
    // which catches it as surely as a marker string would.
    update: (client, entryId, userId) =>
      updateInspectionEntry(client, entryId, userId, {
        conducted_at: "2026-03-03",
        mileage: 132_000,
        result: "Failed",
        next_inspection_date: "2028-03-03",
      }),
    remove: deleteInspectionEntry,
    create: (client, userId, carId) =>
      createInspectionEntry(client, userId, carId, {
        conducted_at: "2026-03-03",
        mileage: 132_000,
        result: "Failed",
        next_inspection_date: "2028-03-03",
      }),
  },
  {
    label: "insurance",
    type: "insurance",
    list: getInsuranceEntries,
    update: (client, entryId, userId, mark) =>
      updateInsuranceEntry(client, entryId, userId, {
        conducted_at: "2026-03-04",
        mileage: 133_000,
        insurer: mark,
        policy_start_date: "2026-03-04",
        renewal_date: "2028-03-04",
      }),
    remove: deleteInsuranceEntry,
    create: (client, userId, carId, mark) =>
      createInsuranceEntry(client, userId, carId, {
        conducted_at: "2026-03-04",
        mileage: 133_000,
        insurer: mark,
        policy_start_date: "2026-03-04",
        renewal_date: "2028-03-04",
      }),
  },
];

describe("R3 · cross-user isolation · entries", () => {
  let users: TwoUsers;
  let carA: Car;
  let carB: Car;

  beforeAll(async () => {
    users = await withTwoUsers();
    // B's car is only ever a place to put B's *own* rows, so one for the file is
    // enough. A's car is re-seeded per test — see below.
    carB = await seedCar(users.userB.client, users.userB.id);
  });

  afterAll(async () => {
    await users.dispose();
  });

  describe.each(ENTRY_CASES)("$label", (entry) => {
    let entryA: SeededEntry;

    beforeEach(async () => {
      // A fresh car *and* entry per test. Sharing one car across the block would
      // let entries accumulate on it, and "A's listing contains exactly her own
      // row" would quietly become "…contains it somewhere among the leftovers".
      carA = await seedCar(users.userA.client, users.userA.id);
      entryA = await seedEntry(users.userA.client, entry.type, { userId: users.userA.id, carId: carA.id });
    });

    /** Ground truth through A's own client — never through the admin one. */
    async function readAsOwner(): Promise<Entry | null> {
      return getEntryById(users.userA.client, entry.type, entryA.id, users.userA.id);
    }

    it("omits A's entry from B's listing of A's car", async () => {
      const seenByB = (await entry.list(users.userB.client, carA.id, users.userB.id)).map((row) => row.id);
      expect(seenByB).not.toContain(entryA.id);

      // The pair: B's own entry on B's own car is visible through the same call.
      const ownEntry = await seedEntry(users.userB.client, entry.type, { userId: users.userB.id, carId: carB.id });
      const seenOnOwnCar = (await entry.list(users.userB.client, carB.id, users.userB.id)).map((row) => row.id);
      expect(seenOnOwnCar).toContain(ownEntry.id);
    });

    it("returns null when B fetches A's entry by id", async () => {
      expect(await getEntryById(users.userB.client, entry.type, entryA.id, users.userB.id)).toBeNull();
    });

    it("returns null even when B supplies A's user id", async () => {
      // The service's own `.eq("user_id", userId)` cannot refuse this — B is
      // asking for precisely the row that filter would admit. Only RLS says no.
      expect(await getEntryById(users.userB.client, entry.type, entryA.id, users.userA.id)).toBeNull();
    });

    it("hides A's entry from a raw select carrying B's JWT", async () => {
      const raw = await users.userB.client.from(ENTRY_TABLES[entry.type]).select("*").eq("id", entryA.id);

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
    });

    it("leaves A's entry unchanged when B updates it", async () => {
      const before = await readAsOwner();

      // `PGRST116` over zero visible rows is mapped to `null` here rather than
      // thrown (`entries.ts`), so the return value is a third signature again.
      // It is not the assertion that matters — the read-back below is.
      await expect(entry.update(users.userB.client, entryA.id, users.userB.id, marker("HACKED"))).resolves.toBeNull();

      expect(await readAsOwner()).toEqual(before);
    });

    it("matches zero rows on a raw update carrying B's JWT", async () => {
      const before = await readAsOwner();

      const raw = await users.userB.client
        .from(ENTRY_TABLES[entry.type])
        .update({ mileage: 999_999 })
        .eq("id", entryA.id)
        .select();

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
      expect(await readAsOwner()).toEqual(before);
    });

    it("returns false and leaves A's entry in place when B deletes it", async () => {
      const before = await readAsOwner();

      await expect(entry.remove(users.userB.client, entryA.id, users.userB.id)).resolves.toBe(false);

      expect(await readAsOwner()).toEqual(before);
    });

    it("matches zero rows on a raw delete carrying B's JWT", async () => {
      const before = await readAsOwner();

      const raw = await users.userB.client.from(ENTRY_TABLES[entry.type]).delete().eq("id", entryA.id).select("id");

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
      expect(await readAsOwner()).toEqual(before);
    });

    it("lets B delete B's own entry — the delete path itself works", async () => {
      const ownEntry = await seedEntry(users.userB.client, entry.type, { userId: users.userB.id, carId: carB.id });

      await expect(entry.remove(users.userB.client, ownEntry.id, users.userB.id)).resolves.toBe(true);

      // Without this, "A's entry survived" is satisfied just as well by a delete
      // that never works for anyone.
      expect(await getEntryById(users.userB.client, entry.type, ownEntry.id, users.userB.id)).toBeNull();
    });

    it("rejects an entry B writes under A's user id", async () => {
      const impersonated = marker("impersonated");

      // Against B's *own* car, so this isolates user_id impersonation from the
      // car_id ownership gap — that one is real today and Phase 3 owns it.
      await expect(entry.create(users.userB.client, users.userA.id, carB.id, impersonated)).rejects.toThrow();

      // And nothing landed under A: her car still carries exactly the one entry
      // this test seeded, no more.
      const seenByA = (await entry.list(users.userA.client, carA.id, users.userA.id)).map((row) => row.id);
      expect(seenByA).toEqual([entryA.id]);
    });

    it("rejects a raw insert carrying B's JWT under A's user id", async () => {
      // The payload has to be one *this* table accepts, otherwise PostgREST
      // answers "column does not exist" and the test would pass for the wrong
      // reason — never reaching the policy it exists to exercise.
      const raw = await users.userB.client.from(ENTRY_TABLES[entry.type]).insert({
        user_id: users.userA.id,
        car_id: carB.id,
        ...validEntryPayload(entry.type),
      });

      expect(raw.error).not.toBeNull();
      expect(raw.error?.code).toBe("42501");
    });

    // ── The car-ownership gap ────────────────────────────────────────────────
    //
    // Everything above is B impersonating A. This is the subtler one: B writes
    // an entry under B's *own* user id — so `WITH CHECK (auth.uid() = user_id)`
    // is satisfied — but points `car_id` at A's car. No policy looks at
    // `car_id`, so today the database accepts it. Only the POST route's 403
    // pre-check stands in the way, and nothing forces a caller through that
    // route.
    //
    // Note what A can and cannot see: the injected row carries B's `user_id`,
    // so RLS hides it from A completely. She cannot detect the pollution on her
    // own car through any query the app makes. Invisible to the victim is not
    // the same as absent — which is why the assertion below reads ground truth
    // through the admin client. That is the one job it has here.
    describe("cross-car insert", () => {
      it("rejects an entry B writes against A's car", async () => {
        await expect(entry.create(users.userB.client, users.userB.id, carA.id, marker("cross-car"))).rejects.toThrow();

        const landed = await users.admin
          .from(ENTRY_TABLES[entry.type])
          .select("id")
          .eq("car_id", carA.id)
          .eq("user_id", users.userB.id);

        expect(landed.error).toBeNull();
        expect(landed.data).toHaveLength(0);
      });

      it("rejects a raw cross-car insert carrying B's JWT", async () => {
        const raw = await users.userB.client.from(ENTRY_TABLES[entry.type]).insert({
          user_id: users.userB.id,
          car_id: carA.id,
          ...validEntryPayload(entry.type),
        });

        expect(raw.error).not.toBeNull();
        expect(raw.error?.code).toBe("42501");
      });
    });
  });

  describe("aggregates", () => {
    beforeEach(async () => {
      carA = await seedCar(users.userA.client, users.userA.id);
      // One entry of every type on A's car, so each aggregate has something to
      // find — and so "B sees nothing" is a real absence, not an empty table.
      for (const entry of ENTRY_CASES) {
        await seedEntry(users.userA.client, entry.type, { userId: users.userA.id, carId: carA.id });
      }
    });

    it("reports no deadlines when B aggregates A's car", async () => {
      const seenByB = await getCarDeadlines(users.userB.client, carA.id, users.userB.id);

      expect(seenByB.oilChange.status).toBe("no_data");
      expect(seenByB.inspection.status).toBe("no_data");
      expect(seenByB.insurance.status).toBe("no_data");
      expect(seenByB.insurance.insurer).toBeNull();

      // The pair: A, on the same car, does see them.
      const seenByA = await getCarDeadlines(users.userA.client, carA.id, users.userA.id);
      expect(seenByA.oilChange.status).not.toBe("no_data");
      expect(seenByA.insurance.insurer).not.toBeNull();
    });

    it("returns no last entry when B asks about A's car", async () => {
      expect(await getLastEntry(users.userB.client, carA.id, users.userB.id)).toBeNull();

      expect(await getLastEntry(users.userA.client, carA.id, users.userA.id)).not.toBeNull();
    });
  });
});
