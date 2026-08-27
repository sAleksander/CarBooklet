import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { logSsrError } from "@/lib/api-errors";
import { LOCALES, DEFAULT_LOCALE } from "@/i18n/config";

const PROTECTED_ROUTES = ["/dashboard", "/cars", "/ai-chat", "/entries"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const { data, error } = await supabase.auth.getUser();

    // supabase-js reports an unreachable auth server in `error` rather than by
    // throwing, so discarding it turns "auth is down" into "nobody is signed in":
    // every protected route below redirects to /auth/signin and nothing anywhere
    // records why. That is the same swallow this change exists to remove.
    //
    // `AuthSessionMissingError` is excluded because it is not a fault — it is
    // what `getUser()` returns for every anonymous request, so logging it would
    // write a line for every visit to the sign-in page. The name comparison is
    // exactly what auth-js's own `isAuthSessionMissingError` does; that guard is
    // not re-exported from `@supabase/supabase-js`, and auth-js is only a
    // transitive dependency here.
    if (error && error.name !== "AuthSessionMissingError") {
      logSsrError(error, { route: "middleware", method: context.request.method });
    }

    context.locals.user = data.user ?? null;
  } else {
    context.locals.user = null;
  }

  // Must be outside the if/else — cookie is readable regardless of Supabase config.
  // App.Locals.selectedCarId is non-optional; placing this inside only one branch causes a TS error.
  context.locals.selectedCarId = context.cookies.get("selected_car_id")?.value ?? null;

  const rawLang = context.cookies.get("lang")?.value;
  context.locals.lang = LOCALES.includes(rawLang as (typeof LOCALES)[number])
    ? (rawLang as (typeof LOCALES)[number])
    : DEFAULT_LOCALE;

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
