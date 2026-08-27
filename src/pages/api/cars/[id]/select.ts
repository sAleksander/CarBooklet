import type { APIRoute } from "astro";
import { z } from "zod";
import type { Car } from "@/types";
import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { apiErrorResponse } from "@/lib/api-errors";

const ROUTE = "/api/cars/[id]/select";

/** See `src/pages/api/cars/[id].ts` — a malformed id is a 400, not a 404. */
const carIdSchema = z.uuid();

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

  const parsedId = carIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return Response.json({ error: parsedId.error.issues[0].message }, { status: 400 });
  }
  const id = parsedId.data;

  // The third swallow site. Selecting a car writes a year-long cookie, so a
  // fault answered as "not found" here left the user unable to select a car
  // they own, with nothing recorded anywhere to explain why.
  let car: Car | null;
  try {
    car = await getCarById(supabase, id, user.id);
  } catch (err) {
    return apiErrorResponse(err, { route: ROUTE, method: "POST", userId: user.id });
  }
  if (!car) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  context.cookies.set("selected_car_id", id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 31536000,
  });

  return Response.json({ success: true });
};
