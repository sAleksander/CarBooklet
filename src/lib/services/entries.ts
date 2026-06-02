import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RepairEntry,
  RepairEntryFormData,
  OilChangeEntry,
  OilChangeEntryFormData,
  InspectionEntry,
  InspectionEntryFormData,
  InsuranceEntry,
  InsuranceEntryFormData,
} from "@/types";

export async function getRepairEntries(
  supabase: SupabaseClient,
  carId: string,
  userId: string,
): Promise<RepairEntry[]> {
  const res = await supabase
    .from("repair_entries")
    .select("*")
    .eq("car_id", carId)
    .eq("user_id", userId)
    .order("conducted_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Omit<RepairEntry, "entry_type">[]).map((row) => ({ ...row, entry_type: "repair" as const }));
}

export async function createRepairEntry(
  supabase: SupabaseClient,
  userId: string,
  carId: string,
  data: RepairEntryFormData,
): Promise<RepairEntry> {
  const res = await supabase
    .from("repair_entries")
    .insert({ user_id: userId, car_id: carId, ...data })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<RepairEntry, "entry_type">;
  return { ...row, entry_type: "repair" as const };
}

export async function getOilChangeEntries(
  supabase: SupabaseClient,
  carId: string,
  userId: string,
): Promise<OilChangeEntry[]> {
  const res = await supabase
    .from("oil_change_entries")
    .select("*")
    .eq("car_id", carId)
    .eq("user_id", userId)
    .order("conducted_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Omit<OilChangeEntry, "entry_type">[]).map((row) => ({
    ...row,
    entry_type: "oil_change" as const,
  }));
}

export async function createOilChangeEntry(
  supabase: SupabaseClient,
  userId: string,
  carId: string,
  data: OilChangeEntryFormData,
): Promise<OilChangeEntry> {
  const res = await supabase
    .from("oil_change_entries")
    .insert({ user_id: userId, car_id: carId, ...data })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<OilChangeEntry, "entry_type">;
  return { ...row, entry_type: "oil_change" as const };
}

export async function getInspectionEntries(
  supabase: SupabaseClient,
  carId: string,
  userId: string,
): Promise<InspectionEntry[]> {
  const res = await supabase
    .from("inspection_entries")
    .select("*")
    .eq("car_id", carId)
    .eq("user_id", userId)
    .order("conducted_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Omit<InspectionEntry, "entry_type">[]).map((row) => ({
    ...row,
    entry_type: "inspection" as const,
  }));
}

export async function createInspectionEntry(
  supabase: SupabaseClient,
  userId: string,
  carId: string,
  data: InspectionEntryFormData,
): Promise<InspectionEntry> {
  const res = await supabase
    .from("inspection_entries")
    .insert({ user_id: userId, car_id: carId, ...data })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<InspectionEntry, "entry_type">;
  return { ...row, entry_type: "inspection" as const };
}

export async function getInsuranceEntries(
  supabase: SupabaseClient,
  carId: string,
  userId: string,
): Promise<InsuranceEntry[]> {
  const res = await supabase
    .from("insurance_entries")
    .select("*")
    .eq("car_id", carId)
    .eq("user_id", userId)
    .order("conducted_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Omit<InsuranceEntry, "entry_type">[]).map((row) => ({
    ...row,
    entry_type: "insurance" as const,
  }));
}

export async function createInsuranceEntry(
  supabase: SupabaseClient,
  userId: string,
  carId: string,
  data: InsuranceEntryFormData,
): Promise<InsuranceEntry> {
  const res = await supabase
    .from("insurance_entries")
    .insert({ user_id: userId, car_id: carId, ...data })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<InsuranceEntry, "entry_type">;
  return { ...row, entry_type: "insurance" as const };
}
