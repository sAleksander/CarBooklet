import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { deleteConversation } from "@/lib/services/conversations";
import { apiErrorResponse } from "@/lib/api-errors";

const ROUTE = "/api/ai/conversations/[id]";

/**
 * Validating the path parameter is what keeps `400` and `404` distinct.
 *
 * Without it `/api/ai/conversations/abc` reaches PostgREST, comes back
 * `22P02 invalid input syntax for type uuid`, and surfaces as a 500 for what is
 * plainly the client's mistake. Same reasoning, same shape, as `cars/[id]`.
 */
const conversationIdSchema = z.uuid();

export const DELETE: APIRoute = async (context) => {
  // Auth off `locals.user` like the chat route, rather than a second
  // `auth.getUser()` round-trip: middleware has already resolved the user for
  // every request that reaches here.
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = context.locals.user;

  const parsedId = conversationIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return Response.json({ error: parsedId.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  try {
    const deleted = await deleteConversation(supabase, parsedId.data, user.id);
    // A zero-row delete used to report success elsewhere in this codebase; the
    // service's `.select("id")` tail is what makes the difference knowable, and
    // "not yours" answers 404, never 403 — the id is not the client's business.
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // The thread's messages go with it: `messages.conversation_id` is
    // ON DELETE CASCADE.
    return Response.json({ success: true });
  } catch (err) {
    return apiErrorResponse(err, { route: ROUTE, method: "DELETE", userId: user.id });
  }
};
