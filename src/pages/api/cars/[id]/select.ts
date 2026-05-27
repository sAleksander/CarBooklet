import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";

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

  const { id } = context.params;
  if (!id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const car = await getCarById(supabase, id).catch(() => null);
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
