/**
 * The service layer's error channel.
 *
 * Every service function funnels database failures through `ServiceError`, which
 * preserves what PostgREST actually said instead of flattening it into a bare
 * message. Routes need `code` to decide a status; operators need `details` and
 * `hint` to diagnose. `new Error(res.error.message)` threw both away.
 *
 * Deliberately HTTP-ignorant. The service layer knows about databases, not
 * status codes — the code→status decision lives at the route boundary. Keeping
 * that split is what lets one service function serve an API route and an SSR
 * page without either inheriting the other's idea of what a failure means.
 *
 * Absence is *not* an error. A row that does not exist, or is not yours, comes
 * back as `null` in the data channel. Only genuine faults travel here.
 */

/**
 * The shape this module reads off a database error.
 *
 * Structural rather than `PostgrestError` itself so that a transport fault — which
 * supabase-js reports as a populated error object with `code: ""` rather than as a
 * rejection — and a hand-built test double both fit without a cast.
 */
export interface DatabaseErrorLike {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export class ServiceError extends Error {
  /**
   * The PostgREST or Postgres code, e.g. `22P02`, `42501`, `PGRST116`.
   *
   * Empty string for transport faults: supabase-js catches fetch failures, DNS
   * errors and aborts internally and reports them as an error object with no
   * code. That is a real value, not a missing one, and the mapper maps it.
   */
  readonly code: string;

  /** Operator-only. May contain an entire failing row, including `user_id`. */
  readonly details: string | null;

  /** Operator-only. PostgREST's suggested remedy, when it offers one. */
  readonly hint: string | null;

  /** The service function that failed, for log attribution. */
  readonly op: string;

  constructor(message: string, code: string, details: string | null, hint: string | null, op: string) {
    super(message);
    // Without this the name is inherited as "Error", and a serialized log line
    // gives no clue which layer produced it.
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
    this.hint = hint;
    this.op = op;
  }
}

/**
 * Build a `ServiceError` from whatever the database returned.
 *
 * `op` is the calling service function's name. Pass it as a literal — it becomes
 * the `op` field of the structured log line at the route boundary, and a wrong
 * one sends the operator to the wrong function.
 */
export function toServiceError(error: DatabaseErrorLike, op: string): ServiceError {
  return new ServiceError(error.message, error.code ?? "", emptyToNull(error.details), emptyToNull(error.hint), op);
}

/**
 * Narrow an unknown caught value to a `ServiceError`.
 *
 * Load-bearing: `eslint.config.js` runs `strictTypeChecked`, so a caught `err` is
 * `unknown` and every consumer needs a real type guard rather than a cast.
 */
export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

/**
 * PostgREST sends `""` for details and hint it has nothing to say about. An empty
 * string in a log line reads as "there was a detail and it was blank"; `null` reads
 * as "there was none".
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : value;
}
