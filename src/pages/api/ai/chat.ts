import type { APIRoute } from "astro";
import { z } from "zod";
import { createChatStream, isRateLimitError, rateLimitHeaders } from "@/lib/services/ai";
import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { getRecentEntries } from "@/lib/services/entries";
import {
  getConversationById,
  createConversation,
  getMessages,
  appendMessage,
  touchConversation,
} from "@/lib/services/conversations";
import { apiErrorResponse, logApiError, type ApiErrorContext } from "@/lib/api-errors";
import { runAfterResponse } from "@/lib/after-response";
import { buildHistoryWindow, titleFromPrompt, DONE_TERMINATOR, type ChatFrame } from "@/lib/chat";
import type { Conversation, Entry, MessageStatus } from "@/types";

const ROUTE = "/api/ai/chat";

export const chatRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(2000, "Prompt is too long"),
  /**
   * Absent starts a new thread. Present resumes one — and the route still
   * decides whether the caller may, from the row it reads, never from this.
   */
  conversation_id: z.uuid().optional(),
});

/** Every frame goes out through here, so the wire format is written in one place. */
function frame(data: ChatFrame): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = context.locals.user;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = chatRequestSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }
  const { prompt, conversation_id: conversationId } = result.data;

  const selectedCarId = context.locals.selectedCarId;
  if (!selectedCarId) {
    return Response.json({ error: "No car selected" }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const errorContext: ApiErrorContext = { route: ROUTE, method: "POST", userId: user.id };

  // Same unvalidated `selected_car_id` cookie as `ai-chat.astro`. Unhandled, a
  // malformed value threw out of the route entirely.
  let car;
  try {
    car = await getCarById(supabase, selectedCarId, user.id);
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }
  if (!car) {
    return Response.json({ error: "Car not found" }, { status: 404 });
  }

  // Resolve the thread before anything is written, and before the model is
  // touched at all — the R1 guard generalised: a conversation the caller may not
  // use must cost nothing from the daily request cap.
  let conversation: Conversation;
  let history;
  try {
    if (conversationId) {
      const existing = await getConversationById(supabase, conversationId, user.id);
      // `null` is "not yours or not there". A thread belonging to a *different*
      // car of the same user is refused the same way and with the same status:
      // 404 keeps meaning exactly one thing, and the caller's correct reaction
      // is identical either way. It also stops the selected-car cookie from
      // silently re-grounding a transcript on a car it was never about.
      if (existing?.car_id !== car.id) {
        return Response.json({ error: "Conversation not found" }, { status: 404 });
      }
      conversation = existing;
      history = buildHistoryWindow(await getMessages(supabase, conversation.id, user.id));
    } else {
      conversation = await createConversation(supabase, {
        user_id: user.id,
        car_id: car.id,
        title: titleFromPrompt(prompt),
        locale: context.locals.lang,
      });
      history = { turns: [], truncated: false };
    }
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }

  let entries: Entry[];
  try {
    entries = await getRecentEntries(supabase, car.id, user.id);
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }

  // The user's turn is written *before* the call, so a question survives a
  // failure that happens after it was asked. A 429 or a 500 therefore leaves a
  // question with no answer, which the transcript shows and the next turn's
  // window skips — better than losing what the user typed.
  try {
    await appendMessage(supabase, {
      conversation_id: conversation.id,
      user_id: user.id,
      role: "user",
      content: prompt,
      status: "complete",
    });
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }

  // Aborting the upstream request is the whole reason this exists: without it a
  // reader who walks away leaves the Worker consuming OpenRouter to completion,
  // spending a request from a capped daily budget for nobody.
  const upstream = new AbortController();

  let stream: Awaited<ReturnType<typeof createChatStream>>;
  try {
    stream = await createChatStream({
      car,
      entries,
      locale: conversation.locale,
      history: history.turns,
      prompt,
      sessionId: conversation.id,
      signal: upstream.signal,
    });
  } catch (err) {
    // The thread and the user's question are already committed by this point,
    // so the id goes out with the failure. Without it the client has no way to
    // learn which thread its question landed in — the `meta` frame is the only
    // other carrier and it never gets sent — and the next attempt opens a
    // *second* thread holding a second copy. Against a 50/day cap a 429 is an
    // ordinary outcome, so that duplication is a matter of when, not if.
    if (isRateLimitError(err)) {
      const limits = rateLimitHeaders(err);
      logApiError(
        err,
        { ...errorContext, extra: { rateLimitRemaining: limits.remaining, rateLimitReset: limits.reset } },
        { status: 429, message: "AI assistant is rate-limited" },
      );
      return Response.json(
        { error: "AI assistant is rate-limited", conversation_id: conversation.id },
        { status: 429 },
      );
    }
    // F9: one flat object through logApiError, never a prefix string plus a
    // positional error. That older form collapsed into a single unqueryable
    // string *and* wrote the SDK's message — which carries the API key on a
    // 401 — into Workers Logs verbatim.
    logApiError(err, errorContext, { status: 500, message: "AI service error" });
    return Response.json({ error: "AI service error", conversation_id: conversation.id }, { status: 500 });
  }

  const encoder = new TextEncoder();

  // Accumulated server-side, which is what makes the reply persistable at all:
  // the client's copy is unreachable, and it is exactly the copy that is missing
  // when the client is the thing that went away.
  let answer = "";
  let model: string | null = null;
  let committed = false;
  let clientGone = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  /**
   * Write one frame, best-effort.
   *
   * Best-effort because the reader may be gone, and `enqueue` throwing is how we
   * find out — it is the only server-side signal of a disconnect that actually
   * arrives. (`cancel()` is the documented one and does not fire here: verified
   * against `wrangler dev` on workerd, where killing a reader mid-stream ran
   * neither the cancel handler nor the completion path.) Noticing early is what
   * lets the upstream request be aborted instead of generating for nobody.
   */
  function push(payload: ChatFrame | string): void {
    if (clientGone || !controller) return;
    const text = typeof payload === "string" ? payload : frame(payload);
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      clientGone = true;
      upstream.abort();
    }
  }

  function closeStream(): void {
    if (!controller) return;
    try {
      controller.close();
    } catch {
      // Already closed or errored by the platform. Nothing to do, and throwing
      // here would replace a finished response with an unhandled rejection.
    }
    controller = null;
  }

  /**
   * Write the assistant's turn, once.
   *
   * Guarded because more than one path can reach it. Never throws: it runs after
   * the response, where a rejection has nowhere to go.
   */
  async function commit(status: MessageStatus): Promise<void> {
    if (committed) return;
    committed = true;
    // An empty reply is not a message. The column refuses it anyway
    // (`messages_content_filled`), and a blank bubble tells the user nothing the
    // error frame has not already said.
    if (!answer) return;
    if (!supabase) return;

    try {
      await appendMessage(supabase, {
        conversation_id: conversation.id,
        user_id: user.id,
        role: "assistant",
        content: answer,
        status,
        model,
      });
      // Ordering the thread list by activity needs an explicit bump: inserting a
      // message touches `messages`, and the parent's trigger only fires on an
      // UPDATE of `conversations`.
      await touchConversation(supabase, conversation.id, user.id);
    } catch (err) {
      logApiError(err, errorContext, { status: 500, message: "Message not persisted" });
    }
  }

  /**
   * Consume the upstream stream to its end and persist the result.
   *
   * This is the whole reason the route is shaped this way. The obvious
   * arrangement — generate inside `ReadableStream.start()` and persist from
   * there — loses the reply whenever the reader goes away: workerd tears the
   * request context down mid-`start()`, so neither the completion path nor
   * `cancel()` ever runs, and a long answer that was most of the way to the
   * user's screen is written nowhere. Handing this task to `waitUntil` *before*
   * the response is returned is what makes it survive that, because the work is
   * already registered before there is anything to interrupt.
   *
   * The response stream becomes a mirror of this task rather than its owner.
   */
  async function drain(): Promise<void> {
    // Always first. A client that started a new thread learns its id here even
    // if the model fails before producing a single token — without it, a failed
    // first turn would strand a conversation the user cannot reload into.
    push({ meta: { conversation_id: conversation.id } });

    try {
      for await (const chunk of stream) {
        // Every chunk names the model the router resolved; the last one wins.
        if (chunk.model) model = chunk.model;
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          answer += delta;
          push({ text: delta });
        }
        // Set by `push` the moment a write fails, and by `cancel()` on the
        // runtimes where that does fire. Either way, stop pulling tokens nobody
        // will read — the request is already paid for, the rest is waste.
        if (clientGone) break;
      }

      const status: MessageStatus = clientGone ? "aborted" : answer ? "complete" : "error";
      // A stream that ended without producing a token needs to say so out loud.
      // `done` alone is not enough: the client commits an empty buffer as no
      // message at all, so the turn would end with the question on screen, the
      // caret gone, and nothing to explain it. An `aborted` turn is exempt —
      // the user pressed stop and already knows why it ended.
      if (status === "error") push({ error: "Stream failed" });
      push({ done: status });
      push(`data: ${DONE_TERMINATOR}\n\n`);
      closeStream();
      await commit(status);
    } catch (err) {
      // An abort is not a fault: it is this route cancelling its own request
      // once it noticed the reader had gone.
      if (clientGone) {
        closeStream();
        await commit("aborted");
        return;
      }
      logApiError(err, errorContext, { status: 500, message: "Stream failed" });
      push({ error: "Stream failed" });
      push({ done: "error" });
      push(`data: ${DONE_TERMINATOR}\n\n`);
      closeStream();
      // Whatever arrived is kept, marked — an unmarked partial would be replayed
      // as context and teach the model to stop mid-word.
      await commit("error");
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    /**
     * Not the load-bearing path — see `drain`. Kept because where it *does* fire
     * it is the earliest possible notice, and stopping the upstream a few
     * hundred tokens sooner is free.
     */
    cancel() {
      clientGone = true;
      upstream.abort();
    },
  });

  // Registered before the Response is returned, so the drain is already under
  // the platform's protection by the time a client could possibly disconnect.
  runAfterResponse(context.locals, drain(), errorContext);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Conversation-Id": conversation.id,
    },
  });
};
