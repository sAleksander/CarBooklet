import type { APIRoute } from "astro";
import { LOCALES } from "@/i18n/config";
import { safeReferer } from "@/lib/safe-redirect";

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

  // Same-origin guarded: a raw Referer in Location is an open redirect.
  return context.redirect(safeReferer(context.request, context.url), 302);
};
