/**
 * The route layer's counterpart to `ServiceError`.
 *
 * This is the only module in the codebase that knows a `22P02` is the client's
 * fault and a `57014` is not. Services throw databases; routes answer HTTP; the
 * translation happens here and nowhere else, so there is exactly one place to
 * read when asking "why did that request return a 503".
 *
 * Two artifacts come out of every failure, and they have different audiences:
 *
 * - **The operator** gets a structured log line carrying the full PostgREST
 *   detail — code, message, details, hint, and the service function that failed.
 * - **The client** gets a fixed generic string and a status code that means what
 *   it says. Nothing Postgres authored ever crosses that boundary.
 *
 * The second half is not a style preference. `23502`'s `details` carries the
 * entire failing row, `user_id` included, and constraint and RLS-policy names
 * are Postgres-authored text that was on screen in this app until this change.
 */

import { isServiceError } from "./services/errors";

/** What a given database error code means in HTTP. */
export interface ErrorMapping {
  status: number;
  /** Fixed literal. Never interpolates anything the database said. */
  message: string;
}

const INVALID_REQUEST: ErrorMapping = { status: 400, message: "Invalid request" };
const UNAUTHORIZED: ErrorMapping = { status: 401, message: "Unauthorized" };
const NOT_FOUND: ErrorMapping = { status: 404, message: "Not found" };
const SERVER_ERROR: ErrorMapping = { status: 500, message: "Server error" };
const SERVICE_UNAVAILABLE: ErrorMapping = { status: 503, message: "Service unavailable" };

/**
 * The specification, in table form. Every row is covered by a case in
 * `src/test/lib/api-errors.test.ts` — a code that silently falls through to the
 * default branch is the failure mode this whole change exists to prevent.
 *
 * Keyed on `code` alone, never on an HTTP status read off the error object:
 * `PostgrestError`'s typed surface is `code`/`message`/`details`/`hint`, and a
 * `status` property is present on some supabase-js versions and absent on others.
 */
const CODE_MAPPINGS = new Map<string, ErrorMapping>([
  ["22P02", INVALID_REQUEST], // malformed uuid
  ["22008", INVALID_REQUEST], // bad date
  ["22003", INVALID_REQUEST], // numeric out of range
  ["23502", INVALID_REQUEST], // not-null violation
  // Check violation — live, not speculative. `20260528000001` applied
  // `CHECK (mileage > 0)` to all four entry tables. The schemas' `.min(1)`
  // refinement is what keeps it unreachable *through the API*; it stays mapped
  // because a direct PostgREST call, or any future column with a CHECK, can
  // still produce it.
  ["23514", INVALID_REQUEST],
  // FK violation → 404, not 400. The only FK a client can violate is `car_id`,
  // and a car that fails the constraint is a car that does not exist or is not
  // yours — the same answer the ownership pre-check would have given a moment
  // earlier. The client's correct reaction is identical either way.
  ["23503", NOT_FOUND],
  // RLS denial → 500, and neither 401 nor 403. This row reverses the plan's
  // decision; the implementation review is what caught it.
  //
  // The plan argued 42501's reachable sense was "the session died mid-request",
  // and mapped it to 401 on that basis. But a dead session cannot reach this
  // code: every route resolves the user first — `middleware.ts` for the entry
  // routes, `supabase.auth.getUser()` for the cars routes — and answers 401
  // before touching PostgREST. Genuine JWT expiry surfaces as `PGRST301`, which
  // has its own row below.
  //
  // What can still produce a live 42501 is a policy or GRANT that does not do
  // what it should — an operator error, not something the caller did wrong and
  // not something the caller can fix. Answering "Unauthorized" sends an
  // authenticated user to sign out and back in, which cannot help, and no client
  // in this repo has a 401 handler to do anything smarter.
  //
  // The ownership sense (added to the entry INSERT/UPDATE policies by
  // `20260825000000` and `20260826000000`) stays unreachable through these
  // routes: all four entry routes pre-check ownership via `getCarById`, and the
  // PATCH schemas do not accept `car_id`. Splitting the senses would mean keying
  // on PostgREST's prose `details`/`hint` — the exact dependency this change
  // exists to remove.
  ["42501", SERVER_ERROR],
  ["PGRST301", UNAUTHORIZED], // JWT verification failed
  // Under `.maybeSingle()` this no longer means "no rows" — it means *more than
  // one*, which every call site here filters on a primary key to prevent. So it
  // is a broken invariant, not a client mistake.
  ["PGRST116", SERVER_ERROR],
  ["PGRST204", SERVER_ERROR], // stale schema cache
  ["57014", SERVICE_UNAVAILABLE], // statement timeout
  // Transport fault: supabase-js catches fetch failures, DNS errors and aborts
  // internally and reports them as a populated error with no code. `""` is a
  // real value, and it is the one that used to read to the user as "your car
  // does not exist".
  ["", SERVICE_UNAVAILABLE],
]);

/**
 * Map a database error code to the status and body the client is allowed to see.
 *
 * An unrecognised code falls to 500. That default is deliberate and asserted:
 * no code may resolve to 404 except `23503`, because `404` has to keep meaning
 * exactly one thing — the row does not exist or is not yours.
 */
export function mapErrorCode(code: string): ErrorMapping {
  return CODE_MAPPINGS.get(code) ?? SERVER_ERROR;
}

/** Where the failure happened. `route` is a literal, not a parsed pathname. */
export interface ApiErrorContext {
  /**
   * The route pattern, e.g. `/api/entries/repair` or `/api/cars/[id]` — written
   * as a literal so `group by route` in Workers Logs groups. A parsed pathname
   * would put every car id in its own bucket.
   */
  route: string;
  method: string;
  userId?: string;
  /**
   * Which boundary failed. Defaults to `"api"`.
   *
   * Load-bearing for log queries: on an SSR page the `status` field is the
   * status this fault *would* map to, not one any response carries — the user
   * gets a 302, or a 200 with an error banner. Without this discriminator an
   * operator filtering `status:503` silently gets a mix of real 503 responses
   * and SSR redirects.
   */
  surface?: "api" | "ssr";
}

/**
 * Emit one structured log line for the operator.
 *
 * A **single object**, never a string plus a second argument: Cloudflare indexes
 * the top-level keys of one logged object and does not merge a second positional
 * argument into them. `console.error("[route] failed:", err)` collapses into one
 * opaque, unqueryable string — which is what `chat.ts` does today and what
 * copying that form twenty times would have produced.
 *
 * `event: "api_error"` is constant so that one query returns every failure
 * app-wide.
 *
 * Never throws. It runs inside a catch block, and an error handler that can fail
 * turns a diagnosable 500 into an unhandled rejection.
 */
export function logApiError(err: unknown, context: ApiErrorContext, mapping: ErrorMapping): void {
  const service = isServiceError(err) ? err : null;

  console.error({
    event: "api_error",
    surface: context.surface ?? "api",
    route: context.route,
    method: context.method,
    userId: context.userId,
    op: service?.op ?? null,
    status: mapping.status,
    code: service?.code ?? "",
    // Operator-only, all three. `details` in particular may contain an entire
    // failing row including `user_id`, which is why it is read here and nowhere
    // near the response body.
    message: messageOf(err),
    details: service?.details ?? null,
    hint: service?.hint ?? null,
  });
}

/**
 * Turn a caught value into a logged, mapped `Response`. A route's catch block is
 * one call to this and nothing else.
 */
export function apiErrorResponse(err: unknown, context: ApiErrorContext): Response {
  // Only a `ServiceError` carries a code the table can trust. The distinction
  // matters at exactly one code: `""` from a service means "supabase-js could
  // not reach the database" and maps to 503, while `""` standing in for a stray
  // `TypeError` means nothing of the sort. A JS bug in a route is a server
  // error, not a database outage.
  const mapping = isServiceError(err) ? mapErrorCode(err.code) : SERVER_ERROR;

  logApiError(err, context, mapping);

  return Response.json({ error: mapping.message }, { status: mapping.status });
}

/**
 * Log an SSR page-load failure.
 *
 * The API counterpart of this returns a `Response`; an `.astro` page has none to
 * return — it redirects, or renders a banner. So the mapped status is computed
 * and recorded (a 503 in the log still tells the operator the database was
 * unreachable) but nothing is built from it.
 *
 * Same single-object shape and same `event: "api_error"` as every other failure,
 * deliberately: one Workers Logs query has to return the whole app, and an SSR
 * load failure is not a different kind of event just because it renders
 * differently.
 */
export function logSsrError(err: unknown, context: ApiErrorContext): void {
  logApiError(err, { ...context, surface: "ssr" }, isServiceError(err) ? mapErrorCode(err.code) : SERVER_ERROR);
}

/**
 * A message for the log line from a value that is only `unknown`.
 *
 * Anything can be thrown, including values that resist being turned into a
 * string at all, so every branch here is reachable in principle and none of them
 * may throw.
 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err !== "object" || err === null) return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    // Circular structure, or a BigInt inside it.
    return "<unserializable thrown value>";
  }
}
