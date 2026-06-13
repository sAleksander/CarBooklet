import type { APIRoute } from "astro";
import { LOCALES } from "@/i18n/config";

export const POST: APIRoute = (context) => {
  const { locale } = context.params;

  if (!locale || !LOCALES.includes(locale as (typeof LOCALES)[number])) {
    return new Response("Not found", { status: 404 });
  }

  context.cookies.set("lang", locale, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 31536000,
  });

  const referer = context.request.headers.get("Referer") ?? "/dashboard";
  return context.redirect(referer, 302);
};
