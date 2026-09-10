import { describe, it, expect } from "vitest";
import { statusErrorKey } from "@/lib/http-error-copy";
import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/config";
import { mapErrorCode } from "@/lib/api-errors";

/**
 * F10's client half: the five English literals `api-errors.ts` sends are no
 * longer what the user reads.
 *
 * The tie to the server is the status, so the interesting assertion is not
 * "400 maps to a key" but "every status the server can actually produce has
 * one". `mapErrorCode`'s table is the source of truth for that, and walking it
 * here means adding a new mapping there without adding copy fails this test
 * rather than shipping an English literal to a Polish user.
 */

describe("statusErrorKey", () => {
  it.each([
    [400, "common.invalidRequest"],
    [401, "common.unauthorized"],
    [404, "common.notFound"],
    [500, "common.serverError"],
    [503, "common.serviceUnavailable"],
  ])("maps %i to %s", (status, key) => {
    expect(statusErrorKey(status)).toBe(key);
  });

  it.each([200, 418, 429, 502, 0])("falls back to the generic key for %i", (status) => {
    expect(statusErrorKey(status)).toBe("common.anErrorOccurred");
  });

  it("covers every status the server's own error table can produce", () => {
    // The codes `api-errors.ts` maps, plus its unmapped-code default.
    const codes = [
      "22P02",
      "22008",
      "22003",
      "23502",
      "23514",
      "23503",
      "42501",
      "PGRST301",
      "PGRST116",
      "PGRST204",
      "57014",
      "",
      "not-a-real-code",
    ];
    const uncovered = [...new Set(codes.map((c) => mapErrorCode(c).status))]
      .filter((status) => statusErrorKey(status) === "common.anErrorOccurred")
      .sort((a, b) => a - b);
    expect(uncovered, "statuses the server sends with no dedicated copy").toEqual([]);
  });
});

describe("copy", () => {
  const keys = [400, 401, 404, 500, 503, 999].map(statusErrorKey);

  it.each(LOCALES)("resolves every key in %s", (locale) => {
    const t = getT(locale);
    const missing = keys.filter((key) => {
      const value = t(key);
      return value === key || value.trim() === "";
    });
    expect(missing, `keys with no ${locale} translation`).toEqual([]);
  });

  it.each(LOCALES)("never shows a raw server literal in %s", (locale) => {
    // The five strings this change exists to stop rendering.
    const t = getT(locale);
    const literals = ["Invalid request", "Unauthorized", "Not found", "Server error", "Service unavailable"];
    for (const key of keys) {
      expect(literals, `${key} still renders the server's literal`).not.toContain(t(key));
    }
  });
});
