import type { APIRoute } from "astro";
import { z } from "zod";
import type { Car } from "@/types";
import { createClient } from "@/lib/supabase";
import { getCarById, updateCar, deleteCar } from "@/lib/services/cars";
import { apiErrorResponse } from "@/lib/api-errors";

const ROUTE = "/api/cars/[id]";

/**
 * Validating the path parameter is what keeps `400` and `404` distinct.
 *
 * Without it `/api/cars/abc` reaches PostgREST, comes back `22P02 invalid input
 * syntax for type uuid`, and — now that faults are no longer swallowed — would
 * surface as a 500 for what is plainly the client's mistake. The old code hid
 * that behind a blanket 404, which is the conflation this change exists to undo.
 */
const carIdSchema = z.uuid();

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

  const parsedId = carIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return Response.json({ error: parsedId.error.issues[0].message }, { status: 400 });
  }
  const id = parsedId.data;

  const errorContext = { route: ROUTE, method: "PATCH", userId: user.id };

  // The swallow this change was opened for. The old inline `.catch` that turned
  // every rejection into `null` could not catch the authorization case —
  // `getCarById` reports that as `null` in the data channel — so everything it
  // did catch was a genuine fault, answered with "your car does not exist" and
  // no server-side trace.
  let existing: Car | null;
  try {
    existing = await getCarById(supabase, id, user.id);
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }
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
    return apiErrorResponse(err, errorContext);
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

  const parsedId = carIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return Response.json({ error: parsedId.error.issues[0].message }, { status: 400 });
  }
  const id = parsedId.data;

  const errorContext = { route: ROUTE, method: "DELETE", userId: user.id };

  let existing: Car | null;
  try {
    existing = await getCarById(supabase, id, user.id);
  } catch (err) {
    return apiErrorResponse(err, errorContext);
  }
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
    return apiErrorResponse(err, errorContext);
  }
};
