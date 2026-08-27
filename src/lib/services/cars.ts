import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, CarFormData } from "@/types";
import { toServiceError } from "./errors";

export async function getCars(supabase: SupabaseClient): Promise<Car[]> {
  const res = await supabase.from("cars").select("*").order("created_at", { ascending: false });
  if (res.error) throw toServiceError(res.error, "getCars");
  return res.data as Car[];
}

export async function getCarById(supabase: SupabaseClient, id: string, userId: string): Promise<Car | null> {
  // `.maybeSingle()` rather than `.single()`: a car that does not exist, or is not
  // yours, is absence — it belongs in the data channel. `.single()` reported it as
  // `PGRST116`, which meant every caller had to string-match a code to tell "no
  // such row" from "the database is broken". `PGRST116` never meant "not found"
  // anyway; it means "not exactly one row", which a duplicate would also produce.
  const res = await supabase.from("cars").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (res.error) throw toServiceError(res.error, "getCarById");
  if (!res.data) return null;
  return res.data as Car;
}

export async function createCar(supabase: SupabaseClient, data: CarFormData & { user_id: string }): Promise<Car> {
  const res = await supabase.from("cars").insert(data).select().single();
  if (res.error) throw toServiceError(res.error, "createCar");
  return res.data as Car;
}

/**
 * Returns `null` when no car with this id belongs to `userId`.
 *
 * The `.eq("user_id", userId)` filter is defense in depth, not the isolation
 * boundary — RLS is. `integration/isolation-cars.test.ts` asserts every cross-user
 * mutation twice, once here and once through a raw JWT-carrying PostgREST call,
 * precisely so this filter cannot hide a policy regression.
 */
export async function updateCar(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  data: Partial<CarFormData>,
): Promise<Car | null> {
  const res = await supabase.from("cars").update(data).eq("id", id).eq("user_id", userId).select().maybeSingle();
  if (res.error) throw toServiceError(res.error, "updateCar");
  if (!res.data) return null;
  return res.data as Car;
}

/**
 * Returns whether a row was actually deleted.
 *
 * The `.select("id")` tail is what makes that knowable. Without it PostgREST
 * answers `204` with `error: null` whether it removed one row or none, so a
 * refused cross-user delete was indistinguishable from a successful one — the
 * zero-row DELETE bug already fixed once for entries.
 */
export async function deleteCar(supabase: SupabaseClient, id: string, userId: string): Promise<boolean> {
  const res = await supabase.from("cars").delete().eq("id", id).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteCar");
  return res.data.length > 0;
}
