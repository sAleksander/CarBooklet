import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationCreateData, Message, MessageCreateData } from "@/types";
import { toServiceError } from "./errors";

/**
 * Chat threads and their messages.
 *
 * Same contract as `cars.ts` and `entries.ts`: `supabase` first, an explicit
 * `.eq("user_id", userId)` on every query as defense in depth on top of RLS —
 * not as the isolation boundary, which is the policies — and absence reported as
 * `null` or `false` in the data channel rather than as a throw.
 * `integration/isolation-conversations.test.ts` asserts every cross-user case
 * twice, once through these functions and once through a raw PostgREST call, so
 * that these filters cannot hide a policy regression.
 */

export async function listConversations(
  supabase: SupabaseClient,
  carId: string,
  userId: string,
): Promise<Conversation[]> {
  const res = await supabase
    .from("conversations")
    .select("*")
    .eq("car_id", carId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (res.error) throw toServiceError(res.error, "listConversations");
  return res.data as Conversation[];
}

/** Returns `null` when no conversation with this id belongs to `userId`. */
export async function getConversationById(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<Conversation | null> {
  const res = await supabase.from("conversations").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (res.error) throw toServiceError(res.error, "getConversationById");
  if (!res.data) return null;
  return res.data as Conversation;
}

export async function createConversation(
  supabase: SupabaseClient,
  data: ConversationCreateData,
): Promise<Conversation> {
  const res = await supabase.from("conversations").insert(data).select().single();
  if (res.error) throw toServiceError(res.error, "createConversation");
  return res.data as Conversation;
}

/**
 * Returns whether a row was actually deleted.
 *
 * The `.select("id")` tail is what makes that knowable — without it PostgREST
 * answers `204` with `error: null` whether it removed one row or none, so a
 * refused cross-user delete would be indistinguishable from a successful one.
 * Same shape, and same reason, as `deleteCar`.
 *
 * `messages.conversation_id` is `ON DELETE CASCADE`, so the thread's messages go
 * with it without a second call.
 */
export async function deleteConversation(supabase: SupabaseClient, id: string, userId: string): Promise<boolean> {
  const res = await supabase.from("conversations").delete().eq("id", id).eq("user_id", userId).select("id");
  if (res.error) throw toServiceError(res.error, "deleteConversation");
  return res.data.length > 0;
}

/**
 * One thread's messages, oldest first — the order both the transcript and the
 * context window are built in.
 *
 * `limit` is a safety bound, not pagination: it caps what a single pathological
 * thread can pull into a Worker's memory. The bound has to trim the *head* of
 * the thread, which is why the query orders descending and the result is
 * reversed here rather than ordering ascending and letting LIMIT cut the tail.
 * Postgres applies ORDER BY before LIMIT, so ascending + LIMIT would return the
 * OLDEST rows: past the bound the replayed window would be built from the
 * thread's opening turns and the transcript would stop before the message the
 * user just sent — both silently. Reversing in JS keeps the oldest-first
 * contract every caller depends on. If threads ever need to render beyond the
 * bound, that is a paging feature, not a bigger number.
 */
export async function getMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  limit = 200,
): Promise<Message[]> {
  const res = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) throw toServiceError(res.error, "getMessages");
  // Newest-first off the wire, oldest-first out the door.
  return (res.data as Message[]).reverse();
}

export async function appendMessage(supabase: SupabaseClient, data: MessageCreateData): Promise<Message> {
  const res = await supabase.from("messages").insert(data).select().single();
  if (res.error) throw toServiceError(res.error, "appendMessage");
  return res.data as Message;
}

/**
 * Bump a thread's `updated_at` so the list orders by activity.
 *
 * Needed because the trigger fires on UPDATE of `conversations` and nothing else
 * — inserting a message touches only `messages`, leaving the parent's timestamp
 * at whatever the last edit set. Without this call a busy thread sinks below an
 * idle one that happened to be created later.
 *
 * The value is written explicitly rather than left to the trigger: an UPDATE
 * needs at least one changed column to be worth issuing, and `updated_at` is the
 * only column a bump is allowed to touch. The trigger then overwrites it with
 * `NOW()`, which is the authoritative value — the one sent here only makes the
 * statement non-empty.
 */
export async function touchConversation(supabase: SupabaseClient, id: string, userId: string): Promise<void> {
  const res = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (res.error) throw toServiceError(res.error, "touchConversation");
}
