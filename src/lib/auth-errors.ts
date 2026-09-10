/**
 * The GoTrue counterpart to `api-errors.ts`.
 *
 * Same rule, different subsystem: the operator gets the real failure in a
 * structured log line, the client gets something from a closed set. The one
 * difference is what may cross the boundary. PostgREST authors prose, so
 * `api-errors.ts` can only ever send a fixed English literal. GoTrue authors an
 * *enum* — `ErrorCode` in `@supabase/auth-js` is a 86-member union — so a code
 * can cross, be carried in a query string, and be translated on the far side.
 *
 * That is what makes F8 fixable at all. Before this module, both auth routes
 * did `?error=${encodeURIComponent(error.message)}` and the sign-in page
 * rendered whatever came back, which meant two things: any crafted link could
 * put attacker-chosen prose inside the app's own alert box on the real origin,
 * and the message distinguished "wrong password" from "no such account".
 *
 * Nothing here is user-facing text. `mapAuthError` returns a *code*; the page
 * decides the copy, through the same `getT` the rest of the app uses.
 */

import { isAuthApiError, isAuthError } from "@supabase/supabase-js";

/**
 * Every value `?error=` is allowed to carry. Anything else the page throws away.
 *
 * A tuple rather than a union type alone: the runtime needs the list to
 * validate a query parameter, and `src/test/lib/auth-errors.test.ts` walks it to
 * prove every member resolves in both locales. A code with no translation is a
 * key path rendered to the user, and nothing else would catch it.
 */
export const AUTH_ERROR_CODES = [
  "invalid_credentials",
  "email_not_confirmed",
  "email_exists",
  "weak_password",
  "signup_disabled",
  "invalid_email",
  "rate_limited",
  "unavailable",
  "not_configured",
  "unknown",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const CODE_SET = new Set<string>(AUTH_ERROR_CODES);

/**
 * The allowlist guard, and the actual fix for the phishing half of F8.
 *
 * The page passes whatever is in the URL through this before resolving copy, so
 * `?error=Your+account+is+locked,+call+555-0100` renders nothing at all rather
 * than rendering itself.
 */
export function isAuthErrorCode(value: string | null): value is AuthErrorCode {
  return value !== null && CODE_SET.has(value);
}

/**
 * Deliberately narrower than `api-errors.ts`'s `ErrorMapping`, which also
 * carries the message the client is allowed to see. No auth route returns a
 * body — they all redirect — so a message here would be a field with no reader,
 * and a trap: `email_exists` and `email_not_confirmed` share a status, so one
 * shared literal would be visibly wrong copy for one of them the moment anyone
 * started sending it.
 */
interface AuthMapping {
  status: number;
}

const BAD_REQUEST: AuthMapping = { status: 400 };
const TOO_MANY: AuthMapping = { status: 429 };
const UNAVAILABLE: AuthMapping = { status: 503 };

/** The `!supabase` branch has no error object to map, so it names its own. */
export const NOT_CONFIGURED: AuthMapping = { status: 503 };
const SERVER_ERROR: AuthMapping = { status: 500 };

/**
 * GoTrue's code to ours.
 *
 * Deliberately many-to-one in places. `user_banned` collapses into
 * `invalid_credentials` because a distinct answer would tell an attacker that
 * the account exists — the same reason the copy for `invalid_credentials` must
 * not distinguish a wrong password from an unknown address. The three
 * validation codes collapse for the opposite reason: they are the same problem
 * to the person typing, and three near-identical strings is worse copy.
 *
 * `email_exists` is kept distinct in spite of that rule, because it is
 * actionable — it says sign in instead — and on a signup form leaking that an
 * address is taken is unavoidable and universal.
 *
 * `email_not_confirmed` is kept in the set but **collapsed into
 * `invalid_credentials` on the sign-in surface**, which is what `mapAuthError`'s
 * `surface` argument exists for. Left distinct there it is a clean enumeration
 * oracle: one request per address separates an existing-but-unconfirmed account
 * from an unknown one. An earlier version of this module defended keeping it by
 * arguing it was unreachable under `enable_confirmations = false`
 * (supabase/config.toml:209) — but that is the *local* stack. README.md:132
 * records that Supabase requires confirmation by default and that the operator
 * turns it off by hand, so on any real deployment the code is reachable and the
 * oracle is live. A security guarantee must not rest on a dashboard toggle.
 */
const GOTRUE_CODES = new Map<string, AuthErrorCode>([
  ["invalid_credentials", "invalid_credentials"],
  ["user_banned", "invalid_credentials"],
  ["email_not_confirmed", "email_not_confirmed"],
  ["user_already_exists", "email_exists"],
  ["email_exists", "email_exists"],
  ["weak_password", "weak_password"],
  ["signup_disabled", "signup_disabled"],
  ["email_provider_disabled", "signup_disabled"],
  ["validation_failed", "invalid_email"],
  ["email_address_invalid", "invalid_email"],
  ["email_address_not_authorized", "invalid_email"],
  ["over_request_rate_limit", "rate_limited"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["request_timeout", "unavailable"],
]);

const STATUS_BY_CODE: Record<AuthErrorCode, AuthMapping> = {
  invalid_credentials: BAD_REQUEST,
  email_not_confirmed: BAD_REQUEST,
  email_exists: BAD_REQUEST,
  weak_password: BAD_REQUEST,
  signup_disabled: BAD_REQUEST,
  invalid_email: BAD_REQUEST,
  rate_limited: TOO_MANY,
  unavailable: UNAVAILABLE,
  not_configured: UNAVAILABLE,
  unknown: SERVER_ERROR,
};

/** Which form the failure came from. `mapAuthError` answers differently per surface. */
export type AuthSurface = "signin" | "signup";

export interface MappedAuthError {
  /** Safe to put in a query string. Never a message. */
  code: AuthErrorCode;
  /** For the log line only — no auth route returns a body. */
  mapping: AuthMapping;
}

/**
 * Turn anything `signInWithPassword` or `signUp` handed back into a code.
 *
 * Keyed on `error.code` first, because that is the enum. But a whole class of
 * failures never reaches GoTrue and carries no code at all — `auth-js` throws
 * those locally, with only a `name` and a `status`:
 *
 * - `AuthRetryableFetchError` — the network, or any 5xx. `status` is 0 for a
 *   transport failure, which is why this branch cannot key on status alone.
 * - `AuthInvalidCredentialsError` — thrown before any request when neither
 *   email nor phone is supplied, i.e. an empty field that got past the form.
 *
 * The default branch is load-bearing rather than defensive: `auth-js`'s own
 * `error-codes.d.ts` warns that the server may return codes outside the union,
 * so an unrecognised value is expected, not impossible.
 */
export function mapAuthError(err: unknown, surface: AuthSurface): MappedAuthError {
  let code = resolveCode(err);
  // See the table's docstring: distinct on signup, collapsed on sign-in, where
  // it would otherwise answer "does this account exist" for anyone who asks.
  if (surface === "signin" && code === "email_not_confirmed") code = "invalid_credentials";
  return { code, mapping: STATUS_BY_CODE[code] };
}

function resolveCode(err: unknown): AuthErrorCode {
  if (!isAuthError(err)) return "unknown";

  if (err.code !== undefined) {
    const mapped = GOTRUE_CODES.get(err.code);
    if (mapped !== undefined) return mapped;
  }

  // No code, or a code the table does not know. Fall back to what the error
  // *is*, then to what it answered.
  if (err.name === "AuthRetryableFetchError") return "unavailable";
  if (err.name === "AuthInvalidCredentialsError") return "invalid_credentials";
  if (err.name === "AuthWeakPasswordError") return "weak_password";

  // A 5xx from GoTrue with an unmapped code is still an outage, not the
  // caller's mistake — worth separating from `unknown` so the copy can say
  // "try again" rather than "something went wrong".
  if (isAuthApiError(err) && err.status >= 500) return "unavailable";

  return "unknown";
}
