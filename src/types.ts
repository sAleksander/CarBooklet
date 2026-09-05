import type { Locale } from "@/i18n/config";

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

// ─── AI chat types ────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

/**
 * Whether a stored message is the whole thing.
 *
 * Only ever `complete` for a user message — the client had the whole prompt
 * before it sent anything. For an assistant message it records how the stream
 * ended: `aborted` when the reader went away (the user pressed stop, or closed
 * the tab), `error` when the upstream failed part-way through.
 *
 * Load-bearing, not cosmetic. A partial reply replayed as context makes the
 * model imitate a reply that stops mid-word, so `buildHistoryWindow` in
 * `src/lib/chat.ts` drops any pair whose assistant half is not `complete`.
 */
export type MessageStatus = "complete" | "aborted" | "error";

export interface Conversation {
  id: string;
  car_id: string;
  user_id: string;
  title: string;
  /**
   * Fixed when the thread is created, from the UI language at that moment.
   * The system prompt asks for this language on every turn, so a thread answers
   * in one language for its whole life even if the user switches the UI later.
   */
  locale: Locale;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  /**
   * The model OpenRouter actually resolved for this reply, read off the stream
   * chunks. Null on user messages, and on assistant messages the router never
   * named one for. `openrouter/free` picks a different model per request, so
   * this is the only way drift between turns is visible after the fact.
   */
  model: string | null;
  created_at: string;
}

/** What a page hands to the chat island — no ids or timestamps it cannot use. */
export type ChatMessage = Pick<Message, "id" | "role" | "content" | "status">;

export interface ConversationCreateData {
  user_id: string;
  car_id: string;
  title: string;
  locale: Locale;
}

export interface MessageCreateData {
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  model?: string | null;
}
