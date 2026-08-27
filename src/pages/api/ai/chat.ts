import type { APIRoute } from "astro";
import { z } from "zod";
import { createChatStream } from "@/lib/services/ai";
import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { apiErrorResponse } from "@/lib/api-errors";

const promptSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(2000, "Prompt is too long"),
});

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = promptSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const selectedCarId = context.locals.selectedCarId;
  if (!selectedCarId) {
    return Response.json({ error: "No car selected" }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Same unvalidated `selected_car_id` cookie as `ai-chat.astro`. Unhandled, a
  // malformed value threw out of the route entirely.
  let car;
  try {
    car = await getCarById(supabase, selectedCarId, context.locals.user.id);
  } catch (err) {
    return apiErrorResponse(err, { route: "/api/ai/chat", method: "POST", userId: context.locals.user.id });
  }
  if (!car) {
    return Response.json({ error: "Car not found" }, { status: 404 });
  }

  let stream: Awaited<ReturnType<typeof createChatStream>>;
  try {
    stream = await createChatStream(result.data.prompt, car);
  } catch (err) {
    console.error("[ai/chat] Service error:", err);
    return Response.json({ error: "AI service error" }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("[ai/chat] Stream error:", e);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
