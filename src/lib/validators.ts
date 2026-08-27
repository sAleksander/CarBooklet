/**
 * Validators shared across the entry route schemas.
 *
 * These exist so that bad input is refused at the edge, where it costs a 400
 * with a field-specific message, rather than at the database, where it comes
 * back as a `22008` or `22003` and — before this change — as raw Postgres text
 * in the user's face.
 *
 * They are also the half of test-plan risk R5 that lives outside Postgres: the
 * edge and the database must agree about what is acceptable, and the only way
 * that stays true is if the edge rule is written down once.
 */

import { z } from "zod";

/** Days per month, index 0 = January. February is handled by the leap rule. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether a `YYYY-MM-DD` string names a day that actually exists.
 *
 * Written out rather than delegated to `Date`, for two reasons: `new Date(...)`
 * silently rolls `2026-02-30` forward to March 2nd instead of rejecting it, and
 * `Date.UTC` maps a two-digit year onto the 1900s, so a shape-valid `0026-01-01`
 * would be rejected for the wrong reason. The Gregorian leap rule is three
 * clauses; hiding it behind a Date round-trip costs more than it saves.
 */
function isRealCalendarDay(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);

  // Zod runs `.refine` even when the `.regex` before it fails, so this receives
  // malformed input routinely — `"01/01/2026"` arrives as `[NaN]`, leaving month
  // and day `undefined`. Every comparison below would then be false-y and return
  // the right answer by accident. Saying so explicitly is what keeps that true
  // if the comparisons are ever reordered.
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;

  // Postgres `date` has no year zero, so accepting one here would break this
  // module's own contract — that the edge and the database agree about what is
  // valid — and hand the user a `22008` instead of a field-specific message.
  if (year < 1) return false;

  if (month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeapYear ? 29 : DAYS_IN_MONTH[month - 1];

  return day <= maxDay;
}

/**
 * A date string that is both well-shaped and a real calendar day.
 *
 * The regex alone accepts `2026-02-30`, which Postgres answers with `22008` —
 * a 500 for what is plainly a client mistake. Fourteen fields across the four
 * entry routes carried that regex inline; they now share this.
 *
 * `shapeMessage` is a parameter because the sites disagree: most say
 * "Date must be YYYY-MM-DD" and `renewal_date` says "Renewal date must be
 * YYYY-MM-DD". Those strings are asserted by `schemas.test.ts` and rendered in
 * forms, so they are preserved exactly rather than unified.
 */
export function isoDate(shapeMessage: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, shapeMessage)
    .refine(isRealCalendarDay, "Date is not a real calendar date");
}

/**
 * The upper bound of Postgres `integer`, which is the column type behind every
 * `mileage` field.
 *
 * Without it `.min(1)` lets `99999999999` through to the database, which answers
 * `22003 numeric field overflow`.
 */
export const MAX_MILEAGE = 2147483647;

/** The `mileage` rule, identical across all eight entry schemas. */
export function mileage() {
  return z
    .number()
    .int()
    .min(1, "Mileage must be greater than 0")
    .max(MAX_MILEAGE, `Mileage must be ${MAX_MILEAGE} or less`)
    .nullable()
    .optional();
}
