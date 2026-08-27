import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getCars, createCar } from "@/lib/services/cars";
import { apiErrorResponse } from "@/lib/api-errors";

const ROUTE = "/api/cars";

export const carSchema = z.object({
  brand: z.string().min(1, "Brand is required"),
  model: z.string().min(1, "Model is required"),
  production_year: z.string().min(1, "Production year is required"),
  registration_number: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  engine_type: z.enum(["electric", "gas", "diesel", "lpg"]),
  engine_capacity: z.string().min(1, "Engine capacity is required"),
  engine_power: z.string().min(1, "Engine power is required"),
  engine_code: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  vin_number: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cars = await getCars(supabase);
    return Response.json({ cars });
  } catch (err) {
    // The safest site in the change: `CarList.tsx:70,80` discards this message
    // entirely, so nothing user-visible moves. The log line is the whole gain.
    return apiErrorResponse(err, { route: ROUTE, method: "GET", userId: user.id });
  }
};

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = carSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  try {
    const car = await createCar(supabase, { ...result.data, user_id: user.id });
    return Response.json({ car }, { status: 201 });
  } catch (err) {
    // This one *is* rendered, at `CarForm.tsx:226`. Constraint and policy names
    // were on screen here until now.
    return apiErrorResponse(err, { route: ROUTE, method: "POST", userId: user.id });
  }
};
