import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getCarById, updateCar, deleteCar } from "@/lib/services/cars";

export const patchSchema = z.object({
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  production_year: z.string().min(1).optional(),
  registration_number: z
    .string()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  engine_type: z.enum(["electric", "gas", "diesel", "lpg"]).optional(),
  engine_capacity: z.string().min(1).optional(),
  engine_power: z.string().min(1).optional(),
  engine_code: z
    .string()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  vin_number: z
    .string()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
});

export const PATCH: APIRoute = async (context) => {
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

  const { id } = context.params;
  if (!id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const existing = await getCarById(supabase, id, user.id).catch(() => null);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = patchSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  try {
    const car = await updateCar(supabase, id, user.id, result.data);
    // `updateCar` now reports "no such car of yours" as absence rather than a
    // thrown coercion error. Unreachable while the pre-check above stands; kept
    // so removing that pre-check cannot resurrect the 500 it used to produce.
    if (!car) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ car });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};

export const DELETE: APIRoute = async (context) => {
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

  const { id } = context.params;
  if (!id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const existing = await getCarById(supabase, id, user.id).catch(() => null);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const deleted = await deleteCar(supabase, id, user.id);
    // A zero-row delete used to report success. The cookie must not be cleared
    // for a car that is still there.
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (context.cookies.get("selected_car_id")?.value === id) {
      context.cookies.delete("selected_car_id", { path: "/" });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};
