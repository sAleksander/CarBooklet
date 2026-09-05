/**
 * Run work that must outlive the response.
 *
 * Workers tear the isolate down once the response is done — a floating promise
 * is not "slow", it is *dropped*, silently and without a log line
 * (`context/foundation/infrastructure.md`). `waitUntil` is the only extension
 * point, and it buys time after the response completes *or after the client
 * disconnects*, which is exactly the window the chat route needs in order to
 * finish writing an assistant message the reader is no longer waiting for.
 */

import { logApiError, type ApiErrorContext } from "./api-errors";

/**
 * Hand `task` to the platform so it survives the response.
 *
 * `cfContext` is declared optional in `App.Locals` because it genuinely is:
 * unit tests hand-build `locals` as a plain object, and forcing each of them to
 * fake an `ExecutionContext` would buy nothing. When it is missing the promise
 * simply runs detached, which is correct under Node and best-effort under a
 * Worker — and a real Worker always supplies it, so the weaker branch cannot be
 * the one that matters in production.
 *
 * Never throws, and never returns the promise. Callers are inside a stream
 * handler or a `finally`, where an added rejection would replace a diagnosable
 * failure with an unhandled one — so the rejection is logged here, in the one
 * flat-object shape Cloudflare Logs can index.
 */
export function runAfterResponse(locals: App.Locals, task: Promise<unknown>, context: ApiErrorContext): void {
  const swallowed = task.catch((err: unknown) => {
    logApiError(err, context, { status: 500, message: "Deferred task failed" });
  });

  if (locals.cfContext) {
    locals.cfContext.waitUntil(swallowed);
    return;
  }

  void swallowed;
}
