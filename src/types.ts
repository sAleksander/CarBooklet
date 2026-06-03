export type EngineType = "electric" | "gas" | "diesel" | "lpg";

export interface Car {
  id: string;
  user_id: string;
  brand: string;
  model: string;
  production_year: string;
  registration_number: string | null;
  engine_type: EngineType;
  engine_capacity: string;
  engine_power: string;
  engine_code: string | null;
  vin_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface CarFormData {
  brand: string;
  model: string;
  production_year: string;
  registration_number?: string | null;
  engine_type: EngineType;
  engine_capacity: string;
  engine_power: string;
  engine_code?: string | null;
  vin_number?: string | null;
}

// ─── Entry types ──────────────────────────────────────────────────────────────

export type EntryType = "repair" | "oil_change" | "inspection" | "insurance";

interface BaseEntry {
  id: string;
  car_id: string;
  user_id: string;
  conducted_at: string;
  mileage: number | null;
  created_at: string;
  updated_at: string;
}

export interface RepairEntry extends BaseEntry {
  entry_type: "repair";
  description: string;
  cause: string | null;
}

export interface OilChangeEntry extends BaseEntry {
  entry_type: "oil_change";
  oil_details: string | null;
}

export interface InspectionEntry extends BaseEntry {
  entry_type: "inspection";
  result: "Passed" | "Failed" | null;
  next_inspection_date: string | null;
}

export interface InsuranceEntry extends BaseEntry {
  entry_type: "insurance";
  insurer: string | null;
  policy_start_date: string | null;
  renewal_date: string;
}

// Service functions querying separate entry tables must inject entry_type at the return site,
// e.g. `return { ...res.data, entry_type: 'repair' as const }` — the column does not exist in the DB.
export type Entry = RepairEntry | OilChangeEntry | InspectionEntry | InsuranceEntry;

export interface RepairEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  description: string;
  cause?: string | null;
}

export interface OilChangeEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  oil_details?: string | null;
}

export interface InspectionEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  result?: "Passed" | "Failed" | null;
  next_inspection_date?: string | null;
}

export interface InsuranceEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  insurer?: string | null;
  policy_start_date?: string | null;
  renewal_date: string;
}

// ─── Deadline types ───────────────────────────────────────────────────────────

export type DeadlineStatus = "no_data" | "no_next_date" | "red" | "yellow" | "green";

export interface OilChangeDeadline {
  status: DeadlineStatus;
  lastConductedAt: string | null;
  lastMileage: number | null;
  nextDueDate: string | null;
  nextDueMileage: number | null;
}

export interface InspectionDeadline {
  status: DeadlineStatus;
  lastConductedAt: string | null;
  nextInspectionDate: string | null;
}

export interface InsuranceDeadline {
  status: DeadlineStatus;
  renewalDate: string | null;
  insurer: string | null;
}

export interface CarDeadlines {
  oilChange: OilChangeDeadline;
  inspection: InspectionDeadline;
  insurance: InsuranceDeadline;
}
