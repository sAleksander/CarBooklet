import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, CarFormData } from "@/types";

export async function getCars(supabase: SupabaseClient): Promise<Car[]> {
  const res = await supabase.from("cars").select("*").order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return res.data as Car[];
}

export async function getCarById(supabase: SupabaseClient, id: string, userId: string): Promise<Car | null> {
  const res = await supabase.from("cars").select("*").eq("id", id).eq("user_id", userId).single();
  if (res.error) {
    if (res.error.code === "PGRST116") return null;
    throw new Error(res.error.message);
  }
  return res.data as Car;
}

export async function createCar(supabase: SupabaseClient, data: CarFormData & { user_id: string }): Promise<Car> {
  const res = await supabase.from("cars").insert(data).select().single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Car;
}

export async function updateCar(supabase: SupabaseClient, id: string, data: Partial<CarFormData>): Promise<Car> {
  const res = await supabase.from("cars").update(data).eq("id", id).select().single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Car;
}

export async function deleteCar(supabase: SupabaseClient, id: string): Promise<void> {
  const res = await supabase.from("cars").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}
