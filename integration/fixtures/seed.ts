import { randomUUID } from "node:crypto";
import type { Car, EntryType } from "@/types";
import type { TestClient } from "./users";

/**
 * Row seeding, always through the *owner's own* authenticated client.
 *
 * Deliberately not the admin client. Seeding through service-role would skip
 * the INSERT policies, so a seed that RLS would have rejected still lands — and
 * every test built on it would be measuring a state the app cannot produce.
 * Making the seed go through RLS means the fixture is itself a small check that
 * the owner path works, which is the positive control the isolation assertions
 * lean on.
 */

/**
 * Unique marker for anything written to the database.
 *
 * Every seeded row carries one, so "this row leaked into the wrong user's
 * result set" is unambiguous rather than a guess about which fixture wrote what.
 */
export function marker(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${randomUUID().slice(0, 8)}`;
}

export async function seedCar(client: TestClient, userId: string, overrides: Partial<Car> = {}): Promise<Car> {
  const res = await client
    .from("cars")
    .insert({
      user_id: userId,
      brand: "Volvo",
      model: marker("car"),
      production_year: "2019",
      engine_type: "diesel",
      engine_capacity: "2.0L",
      engine_power: "190hp",
      ...overrides,
    })
    .select()
    .single();
  if (res.error) throw new Error(`could not seed car: ${res.error.message}`);
  return res.data as Car;
}

/** The table each entry type lives in. Mirrors the map inside `getEntryById`. */
export const ENTRY_TABLES: Record<EntryType, string> = {
  repair: "repair_entries",
  oil_change: "oil_change_entries",
  inspection: "inspection_entries",
  insurance: "insurance_entries",
};

/**
 * A payload each entry type accepts today.
 *
 * `mileage` is deliberately well above zero: the boundary values belong to the
 * constraint oracle (Phase 4), not to a fixture that other tests depend on.
 */
export function validEntryPayload(type: EntryType): Record<string, unknown> {
  switch (type) {
    case "repair":
      return { conducted_at: "2026-02-01", mileage: 120_000, description: marker("repair"), cause: null };
    case "oil_change":
      return { conducted_at: "2026-02-02", mileage: 121_000, oil_details: marker("oil") };
    case "inspection":
      return {
        conducted_at: "2026-02-03",
        mileage: 122_000,
        result: "Passed",
        next_inspection_date: "2027-02-03",
      };
    case "insurance":
      return {
        conducted_at: "2026-02-04",
        mileage: 123_000,
        insurer: marker("insurer"),
        policy_start_date: "2026-02-04",
        renewal_date: "2027-02-04",
      };
  }
}

export interface SeededEntry {
  id: string;
  car_id: string;
  user_id: string;
  [column: string]: unknown;
}

export async function seedEntry(
  client: TestClient,
  type: EntryType,
  owner: { userId: string; carId: string },
  overrides: Record<string, unknown> = {},
): Promise<SeededEntry> {
  const res = await client
    .from(ENTRY_TABLES[type])
    .insert({
      user_id: owner.userId,
      car_id: owner.carId,
      ...validEntryPayload(type),
      ...overrides,
    })
    .select()
    .single();
  if (res.error) throw new Error(`could not seed ${type} entry: ${res.error.message}`);
  return res.data as SeededEntry;
}

export interface SeededConversation {
  id: string;
  car_id: string;
  user_id: string;
  title: string;
  locale: string;
  [column: string]: unknown;
}

export async function seedConversation(
  client: TestClient,
  owner: { userId: string; carId: string },
  overrides: Record<string, unknown> = {},
): Promise<SeededConversation> {
  const res = await client
    .from("conversations")
    .insert({
      user_id: owner.userId,
      car_id: owner.carId,
      title: marker("thread"),
      locale: "en",
      ...overrides,
    })
    .select()
    .single();
  if (res.error) throw new Error(`could not seed conversation: ${res.error.message}`);
  return res.data as SeededConversation;
}

export interface SeededMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  status: string;
  [column: string]: unknown;
}

export async function seedMessage(
  client: TestClient,
  owner: { userId: string; conversationId: string },
  overrides: Record<string, unknown> = {},
): Promise<SeededMessage> {
  const res = await client
    .from("messages")
    .insert({
      user_id: owner.userId,
      conversation_id: owner.conversationId,
      role: "user",
      content: marker("message"),
      status: "complete",
      ...overrides,
    })
    .select()
    .single();
  if (res.error) throw new Error(`could not seed message: ${res.error.message}`);
  return res.data as SeededMessage;
}
