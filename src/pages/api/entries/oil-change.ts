import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getOilChangeEntries, createOilChangeEntry } from "@/lib/services/entries";
import { getCarById } from "@/lib/services/cars";

const carIdSchema = z.uuid();

const oilChangeEntrySchema = z.object({
  car_id: z.uuid(),
  conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  mileage: z.number().int().min(0).nullable().optional(),
  oil_details: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const carId = new URL(context.request.url).searchParams.get("car_id");
  if (!carId) {
    return Response.json({ error: "car_id is required" }, { status: 400 });
  }

  const parsed = carIdSchema.safeParse(carId);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entries = await getOilChangeEntries(supabase, carId, context.locals.user.id);
    return Response.json({ entries });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};

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

  const result = oilChangeEntrySchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { car_id, conducted_at, mileage, oil_details } = result.data;
    const car = await getCarById(supabase, car_id);
    if (car?.user_id !== context.locals.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const entry = await createOilChangeEntry(supabase, context.locals.user.id, car_id, {
      conducted_at,
      mileage: mileage ?? null,
      oil_details,
    });
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};
