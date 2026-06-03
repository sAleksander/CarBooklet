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
  CarDeadlines,
  DeadlineStatus,
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

// ─── Update functions ─────────────────────────────────────────────────────────

export async function updateRepairEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
  data: RepairEntryFormData,
): Promise<RepairEntry | null> {
  const res = await supabase
    .from("repair_entries")
    .update(data)
    .eq("id", entryId)
    .eq("user_id", userId)
    .select()
    .single();
  if (res.error?.code === "PGRST116") return null;
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<RepairEntry, "entry_type">;
  return { ...row, entry_type: "repair" as const };
}

export async function updateOilChangeEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
  data: OilChangeEntryFormData,
): Promise<OilChangeEntry | null> {
  const res = await supabase
    .from("oil_change_entries")
    .update(data)
    .eq("id", entryId)
    .eq("user_id", userId)
    .select()
    .single();
  if (res.error?.code === "PGRST116") return null;
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<OilChangeEntry, "entry_type">;
  return { ...row, entry_type: "oil_change" as const };
}

export async function updateInspectionEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
  data: InspectionEntryFormData,
): Promise<InspectionEntry | null> {
  const res = await supabase
    .from("inspection_entries")
    .update(data)
    .eq("id", entryId)
    .eq("user_id", userId)
    .select()
    .single();
  if (res.error?.code === "PGRST116") return null;
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<InspectionEntry, "entry_type">;
  return { ...row, entry_type: "inspection" as const };
}

export async function updateInsuranceEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
  data: InsuranceEntryFormData,
): Promise<InsuranceEntry | null> {
  const res = await supabase
    .from("insurance_entries")
    .update(data)
    .eq("id", entryId)
    .eq("user_id", userId)
    .select()
    .single();
  if (res.error?.code === "PGRST116") return null;
  if (res.error) throw new Error(res.error.message);
  const row = res.data as Omit<InsuranceEntry, "entry_type">;
  return { ...row, entry_type: "insurance" as const };
}

// ─── Delete functions ─────────────────────────────────────────────────────────

export async function deleteRepairEntry(supabase: SupabaseClient, entryId: string, userId: string): Promise<boolean> {
  const res = await supabase.from("repair_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw new Error(res.error.message);
  return res.data.length > 0;
}

export async function deleteOilChangeEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("oil_change_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw new Error(res.error.message);
  return res.data.length > 0;
}

export async function deleteInspectionEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("inspection_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw new Error(res.error.message);
  return res.data.length > 0;
}

export async function deleteInsuranceEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("insurance_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw new Error(res.error.message);
  return res.data.length > 0;
}

// ─── Deadline aggregation ─────────────────────────────────────────────────────

function addOneYear(dateStr: string): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().substring(0, 10);
}

function computeDeadlineStatus(dueDateStr: string | null): DeadlineStatus {
  if (!dueDateStr) return "no_data";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dueDate = new Date(dueDateStr);
  const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / 86_400_000);
  if (daysUntil <= 30) return "red";
  if (daysUntil <= 90) return "yellow";
  return "green";
}

export async function getCarDeadlines(supabase: SupabaseClient, carId: string, userId: string): Promise<CarDeadlines> {
  const [oilRes, inspRes, insRes] = await Promise.all([
    supabase
      .from("oil_change_entries")
      .select("*")
      .eq("car_id", carId)
      .eq("user_id", userId)
      .order("conducted_at", { ascending: false })
      .limit(1),
    supabase
      .from("inspection_entries")
      .select("*")
      .eq("car_id", carId)
      .eq("user_id", userId)
      .order("conducted_at", { ascending: false })
      .limit(1),
    supabase
      .from("insurance_entries")
      .select("*")
      .eq("car_id", carId)
      .eq("user_id", userId)
      .order("renewal_date", { ascending: false })
      .limit(1),
  ]);

  if (oilRes.error) throw new Error(oilRes.error.message);
  if (inspRes.error) throw new Error(inspRes.error.message);
  if (insRes.error) throw new Error(insRes.error.message);

  const oil = (oilRes.data[0] ?? null) as Omit<OilChangeEntry, "entry_type"> | null;
  const insp = (inspRes.data[0] ?? null) as Omit<InspectionEntry, "entry_type"> | null;
  const ins = (insRes.data[0] ?? null) as Omit<InsuranceEntry, "entry_type"> | null;

  const nextDueDate = oil ? addOneYear(oil.conducted_at) : null;
  const nextDueMileage = oil?.mileage != null ? oil.mileage + 10_000 : null;

  let inspectionStatus: DeadlineStatus;
  if (!insp) {
    inspectionStatus = "no_data";
  } else if (!insp.next_inspection_date) {
    inspectionStatus = "no_next_date";
  } else {
    inspectionStatus = computeDeadlineStatus(insp.next_inspection_date);
  }

  return {
    oilChange: {
      status: computeDeadlineStatus(nextDueDate),
      lastConductedAt: oil?.conducted_at ?? null,
      lastMileage: oil?.mileage ?? null,
      nextDueDate,
      nextDueMileage,
    },
    inspection: {
      status: inspectionStatus,
      lastConductedAt: insp?.conducted_at ?? null,
      nextInspectionDate: insp?.next_inspection_date ?? null,
    },
    insurance: {
      status: ins ? computeDeadlineStatus(ins.renewal_date) : "no_data",
      renewalDate: ins?.renewal_date ?? null,
      insurer: ins?.insurer ?? null,
    },
  };
}
