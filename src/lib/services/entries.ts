import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Entry,
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
import { toServiceError } from "./errors";

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
  if (res.error) throw toServiceError(res.error, "getRepairEntries");
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
  if (res.error) throw toServiceError(res.error, "createRepairEntry");
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
  if (res.error) throw toServiceError(res.error, "getOilChangeEntries");
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
  if (res.error) throw toServiceError(res.error, "createOilChangeEntry");
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
  if (res.error) throw toServiceError(res.error, "getInspectionEntries");
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
  if (res.error) throw toServiceError(res.error, "createInspectionEntry");
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
  if (res.error) throw toServiceError(res.error, "getInsuranceEntries");
  return (res.data as Omit<InsuranceEntry, "entry_type">[]).map((row) => ({
    ...row,
    entry_type: "insurance" as const,
  }));
}

export async function getEntryById(
  supabase: SupabaseClient,
  entryType: Entry["entry_type"],
  entryId: string,
  userId: string,
): Promise<Entry | null> {
  const tableMap: Record<Entry["entry_type"], string> = {
    repair: "repair_entries",
    oil_change: "oil_change_entries",
    inspection: "inspection_entries",
    insurance: "insurance_entries",
  };
  const res = await supabase
    .from(tableMap[entryType])
    .select("*")
    .eq("id", entryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) throw toServiceError(res.error, "getEntryById");
  if (!res.data) return null;
  switch (entryType) {
    case "repair":
      return { ...(res.data as Omit<RepairEntry, "entry_type">), entry_type: "repair" as const };
    case "oil_change":
      return { ...(res.data as Omit<OilChangeEntry, "entry_type">), entry_type: "oil_change" as const };
    case "inspection":
      return { ...(res.data as Omit<InspectionEntry, "entry_type">), entry_type: "inspection" as const };
    case "insurance":
      return { ...(res.data as Omit<InsuranceEntry, "entry_type">), entry_type: "insurance" as const };
  }
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
  if (res.error) throw toServiceError(res.error, "createInsuranceEntry");
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
    .maybeSingle();
  if (res.error) throw toServiceError(res.error, "updateRepairEntry");
  if (!res.data) return null;
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
    .maybeSingle();
  if (res.error) throw toServiceError(res.error, "updateOilChangeEntry");
  if (!res.data) return null;
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
    .maybeSingle();
  if (res.error) throw toServiceError(res.error, "updateInspectionEntry");
  if (!res.data) return null;
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
    .maybeSingle();
  if (res.error) throw toServiceError(res.error, "updateInsuranceEntry");
  if (!res.data) return null;
  const row = res.data as Omit<InsuranceEntry, "entry_type">;
  return { ...row, entry_type: "insurance" as const };
}

// ─── Delete functions ─────────────────────────────────────────────────────────

export async function deleteRepairEntry(supabase: SupabaseClient, entryId: string, userId: string): Promise<boolean> {
  const res = await supabase.from("repair_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteRepairEntry");
  return res.data.length > 0;
}

export async function deleteOilChangeEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("oil_change_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteOilChangeEntry");
  return res.data.length > 0;
}

export async function deleteInspectionEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("inspection_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteInspectionEntry");
  return res.data.length > 0;
}

export async function deleteInsuranceEntry(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<boolean> {
  const res = await supabase.from("insurance_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteInsuranceEntry");
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

  if (oilRes.error) throw toServiceError(oilRes.error, "getCarDeadlines");
  if (inspRes.error) throw toServiceError(inspRes.error, "getCarDeadlines");
  if (insRes.error) throw toServiceError(insRes.error, "getCarDeadlines");

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

export async function getLastEntry(supabase: SupabaseClient, carId: string, userId: string): Promise<Entry | null> {
  const [repairRes, oilRes, inspRes, insRes] = await Promise.all([
    supabase
      .from("repair_entries")
      .select("*")
      .eq("car_id", carId)
      .eq("user_id", userId)
      .order("conducted_at", { ascending: false })
      .limit(1),
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
      .order("conducted_at", { ascending: false })
      .limit(1),
  ]);
  if (repairRes.error) throw toServiceError(repairRes.error, "getLastEntry");
  if (oilRes.error) throw toServiceError(oilRes.error, "getLastEntry");
  if (inspRes.error) throw toServiceError(inspRes.error, "getLastEntry");
  if (insRes.error) throw toServiceError(insRes.error, "getLastEntry");

  const candidates: Entry[] = [
    ...(repairRes.data[0]
      ? [{ ...(repairRes.data[0] as Omit<RepairEntry, "entry_type">), entry_type: "repair" as const }]
      : []),
    ...(oilRes.data[0]
      ? [{ ...(oilRes.data[0] as Omit<OilChangeEntry, "entry_type">), entry_type: "oil_change" as const }]
      : []),
    ...(inspRes.data[0]
      ? [{ ...(inspRes.data[0] as Omit<InspectionEntry, "entry_type">), entry_type: "inspection" as const }]
      : []),
    ...(insRes.data[0]
      ? [{ ...(insRes.data[0] as Omit<InsuranceEntry, "entry_type">), entry_type: "insurance" as const }]
      : []),
  ];

  const priority: Record<Entry["entry_type"], number> = {
    repair: 0,
    oil_change: 1,
    inspection: 2,
    insurance: 3,
  };
  return candidates.reduce<Entry | null>((best, cur) => {
    if (!best) return cur;
    const delta = new Date(cur.conducted_at).getTime() - new Date(best.conducted_at).getTime();
    if (delta > 0) return cur;
    if (delta === 0 && priority[cur.entry_type] < priority[best.entry_type]) return cur;
    return best;
  }, null);
}
