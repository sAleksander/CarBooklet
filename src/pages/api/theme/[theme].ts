import type { APIRoute } from "astro";
import { isTheme } from "@/lib/theme-preference";

// Mirrors src/pages/api/lang/[locale].ts: a no-JS POST target for a
// <form> control, which full-reloads and so sidesteps any client re-init
// timing issue. Same four cookie attributes.
export const POST: APIRoute = (context) => {
  const { theme } = context.params;

  if (theme === "system") {
    // "system" is the ABSENCE of a preference, not a third value. Deleting the
    // cookie is what lets Phase 7's inline script take over and follow
    // `prefers-color-scheme`.
    context.cookies.delete("theme", { path: "/" });
  } else if (isTheme(theme)) {
    context.cookies.set("theme", theme, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 31536000,
    });
  } else {
    return new Response("Not found", { status: 404 });
  }

  const referer = context.request.headers.get("Referer") ?? "/dashboard";
  return context.redirect(referer, 302);
};
