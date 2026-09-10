/**
 * The client half of the rule `api-errors.ts` states on the server.
 *
 * That module deliberately sends a fixed English literal — "Invalid request",
 * "Not found" and three others — because nothing PostgREST authored may cross
 * to the client. Every consumer then rendered those literals verbatim, so a
 * Polish user saw Polish everywhere except inside an entry form, and the
 * `?? t("common.anErrorOccurred")` fallback beside them never fired, because
 * the server always sends `error`.
 *
 * The fix does not change the envelope. The status line already carries the
 * same information a `code` field would, in a set that is closed by HTTP
 * itself, so the copy can be chosen here and the server's literal ignored.
 * That matters: adding a `code` to the response was ruled out during the
 * swallowed-error-propagation change because it would break the eight
 * `toEqual` assertions in `chat.test.ts`, and this route touches none of them.
 *
 * What this costs, stated plainly: the converted routes do not only send those
 * five literals. Several also send zod-derived 400 bodies that ARE specific —
 * "Brand is required" (`src/pages/api/cars/index.ts`), "Date must be
 * YYYY-MM-DD" (`src/pages/api/entries/repair.ts`), "Invalid JSON". Every one of
 * those now collapses into a single `common.invalidRequest`. That is a real
 * loss of field-level detail, traded for copy the user can actually read in
 * their own language. It is tolerable because the forms validate client-side
 * first, so a 400 is close to unreachable through the UI — but if that stops
 * being true, the fix is a machine code plus a field name in the envelope, not
 * a return to rendering the server's English.
 *
 * Returns a key rather than a string so call sites stay `t(...)` and this
 * module needs no opinion about which i18next instance is in play.
 */

const KEY_BY_STATUS = new Map<number, string>([
  // The five `mapErrorCode` can actually produce. Anything else is a bug or a
  // proxy, and lands on the generic key.
  [400, "common.invalidRequest"],
  [401, "common.unauthorized"],
  [404, "common.notFound"],
  [500, "common.serverError"],
  [503, "common.serviceUnavailable"],
]);

/** Translation key for the copy a failed API response should show. */
export function statusErrorKey(status: number): string {
  return KEY_BY_STATUS.get(status) ?? "common.anErrorOccurred";
}
