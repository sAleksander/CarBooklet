import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import {
  getOilChangeEntries,
  createOilChangeEntry,
  updateOilChangeEntry,
  deleteOilChangeEntry,
} from "@/lib/services/entries";
import { getCarById } from "@/lib/services/cars";
import { apiErrorResponse } from "@/lib/api-errors";

const ROUTE = "/api/entries/oil-change";

const carIdSchema = z.uuid();
const entryIdSchema = z.uuid();

export const oilChangeEntrySchema = z.object({
  car_id: z.uuid(),
  conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  mileage: z.number().int().min(1, "Mileage must be greater than 0").nullable().optional(),
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
    return apiErrorResponse(err, { route: ROUTE, method: "GET", userId: context.locals.user.id });
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
    const car = await getCarById(supabase, car_id, context.locals.user.id);
    if (!car) {
      // 404, not 403. Answering "that car exists, it just is not yours" is the
      // enumeration leak the cars routes already refuse to produce; the repo
      // did it both ways until now. The client's correct reaction is identical.
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const entry = await createOilChangeEntry(supabase, context.locals.user.id, car_id, {
      conducted_at,
      mileage: mileage ?? null,
      oil_details,
    });
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, { route: ROUTE, method: "POST", userId: context.locals.user.id });
  }
};

export const oilChangeEntryPatchSchema = z.object({
  id: z.uuid(),
  conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  mileage: z.number().int().min(1, "Mileage must be greater than 0").nullable().optional(),
  oil_details: z
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

  const result = oilChangeEntryPatchSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, conducted_at, mileage, oil_details } = result.data;
    const entry = await updateOilChangeEntry(supabase, id, context.locals.user.id, {
      conducted_at,
      mileage: mileage ?? null,
      oil_details,
    });
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ entry });
  } catch (err) {
    return apiErrorResponse(err, { route: ROUTE, method: "PATCH", userId: context.locals.user.id });
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
    const deleted = await deleteOilChangeEntry(supabase, parsed.data, context.locals.user.id);
    if (!deleted) return Response.json({ error: "Entry not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    return apiErrorResponse(err, { route: ROUTE, method: "DELETE", userId: context.locals.user.id });
  }
};
