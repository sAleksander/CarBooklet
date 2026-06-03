import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getRepairEntries, createRepairEntry, updateRepairEntry, deleteRepairEntry } from "@/lib/services/entries";
import { getCarById } from "@/lib/services/cars";

const carIdSchema = z.uuid();
const entryIdSchema = z.uuid();

const repairEntrySchema = z.object({
  car_id: z.uuid(),
  conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  mileage: z.number().int().min(0).nullable().optional(),
  description: z.string().min(1, "Description is required"),
  cause: z
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
    const entries = await getRepairEntries(supabase, carId, context.locals.user.id);
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

  const result = repairEntrySchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { car_id, conducted_at, mileage, description, cause } = result.data;
    const car = await getCarById(supabase, car_id);
    if (car?.user_id !== context.locals.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const entry = await createRepairEntry(supabase, context.locals.user.id, car_id, {
      conducted_at,
      mileage: mileage ?? null,
      description,
      cause,
    });
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};

const repairEntryPatchSchema = z.object({
  id: z.uuid(),
  conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  mileage: z.number().int().min(0).nullable().optional(),
  description: z.string().min(1, "Description is required"),
  cause: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = repairEntryPatchSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, conducted_at, mileage, description, cause } = result.data;
    const entry = await updateRepairEntry(supabase, id, context.locals.user.id, {
      conducted_at,
      mileage: mileage ?? null,
      description,
      cause,
    });
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const parsed = entryIdSchema.safeParse(id);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteRepairEntry(supabase, parsed.data, context.locals.user.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};
