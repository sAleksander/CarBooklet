import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { logApiError } from "@/lib/api-errors";
import { mapAuthError, NOT_CONFIGURED } from "@/lib/auth-errors";

const ROUTE = "/api/auth/signup";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    logApiError(
      new Error("Supabase is not configured"),
      { route: ROUTE, method: "POST", surface: "ssr" },
      NOT_CONFIGURED,
    );
    return context.redirect("/auth/signup?error=not_configured");
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // A code, never a message. `error.message` is GoTrue's prose and used to
    // travel to the page verbatim; now it goes only to the operator.
    const { code, mapping } = mapAuthError(error, "signup");
    // Deliberately no email, here or in `extra`. The trace F8 asks for is
    // route + code + status; an address in a log line is a credential-adjacent
    // value sitting somewhere nobody audits.
    logApiError(
      error,
      {
        route: ROUTE,
        method: "POST",
        surface: "ssr",
        // `logApiError` reads `code` off a ServiceError, and an AuthError is not
        // one — left alone the line logs `code: ""` and the operator gets a
        // status and nothing to group by. `extra` spreads last, so naming the
        // field `code` fills that slot rather than adding a second one: one
        // error-code field across both subsystems, which is what makes
        // `group by code` in Workers Logs mean anything.
        //
        // `gotrueCode` is kept beside it because the mapping is many-to-one:
        // `user_banned` and `invalid_credentials` deliberately collapse, and an
        // operator debugging a real report needs to see which one it was.
        extra: { code, gotrueCode: error.code ?? null },
      },
      mapping,
    );
    return context.redirect(`/auth/signup?error=${code}`);
  }

  return context.redirect("/auth/confirm-email");
};
