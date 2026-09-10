import { describe, it, expect } from "vitest";
import { AuthApiError, AuthError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { mapAuthError, isAuthErrorCode, AUTH_ERROR_CODES, type AuthErrorCode } from "@/lib/auth-errors";
import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/config";

/**
 * The table, the guard, and the one invariant that makes a dynamic `t()` safe.
 *
 * Two of these three matter for security rather than correctness. `isAuthErrorCode`
 * is what stops a crafted `?error=` from rendering itself inside the sign-in
 * card. And the copy assertions are what stop the fix from re-introducing the
 * user-enumeration half of F8 through the back door — a mapping can be perfect
 * and the wording can still say "no account with that email".
 */

describe("mapAuthError", () => {
  describe("keyed on GoTrue's code", () => {
    const cases: [string, number, AuthErrorCode, number][] = [
      ["invalid_credentials", 400, "invalid_credentials", 400],
      ["user_banned", 403, "invalid_credentials", 400],
      ["email_not_confirmed", 400, "email_not_confirmed", 400],
      ["user_already_exists", 422, "email_exists", 400],
      ["email_exists", 422, "email_exists", 400],
      ["weak_password", 422, "weak_password", 400],
      ["signup_disabled", 422, "signup_disabled", 400],
      ["email_provider_disabled", 422, "signup_disabled", 400],
      ["validation_failed", 400, "invalid_email", 400],
      ["email_address_invalid", 400, "invalid_email", 400],
      ["email_address_not_authorized", 400, "invalid_email", 400],
      ["over_request_rate_limit", 429, "rate_limited", 429],
      ["over_email_send_rate_limit", 429, "rate_limited", 429],
      ["request_timeout", 504, "unavailable", 503],
    ];

    it.each(cases)("maps %s to %s", (gotrue, httpStatus, expected, mappedStatus) => {
      const result = mapAuthError(new AuthApiError("whatever GoTrue said", httpStatus, gotrue), "signup");
      expect(result.code).toBe(expected);
      expect(result.mapping.status).toBe(mappedStatus);
    });

    it("does not distinguish a banned user from a wrong password", () => {
      // The enumeration guard, asserted rather than trusted to the table above:
      // if someone adds a `user_banned` copy string later, this fails.
      const banned = mapAuthError(new AuthApiError("User is banned", 403, "user_banned"), "signup");
      const wrong = mapAuthError(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"), "signup");
      expect(banned.code).toBe(wrong.code);
    });
  });

  describe("keyed on name or status when there is no code", () => {
    it("treats a transport failure as unavailable, despite status 0", () => {
      // status 0 is why this branch cannot key on status: a naive
      // `status >= 500` test would call a dead network a client error.
      const result = mapAuthError(new AuthRetryableFetchError("fetch failed", 0), "signup");
      expect(result.code).toBe("unavailable");
      expect(result.mapping.status).toBe(503);
    });

    it("treats a 5xx with an unmapped code as unavailable, not unknown", () => {
      const result = mapAuthError(new AuthApiError("upstream exploded", 502, "some_future_code"), "signup");
      expect(result.code).toBe("unavailable");
    });

    it("falls back to unknown for an auth error it cannot place", () => {
      const result = mapAuthError(new AuthError("mystery", 418, undefined), "signup");
      expect(result.code).toBe("unknown");
      expect(result.mapping.status).toBe(500);
    });
  });

  describe("things that are not auth errors at all", () => {
    it.each([
      ["a plain Error", new Error("boom")],
      ["a string", "boom"],
      ["null", null],
      ["undefined", undefined],
    ])("maps %s to unknown", (_label, value) => {
      expect(mapAuthError(value, "signup").code).toBe("unknown");
    });
  });
});

describe("the sign-in surface collapses the account-existence oracle", () => {
  // The half of F8 that the mechanism alone does not close. Left distinct on
  // sign-in, `email_not_confirmed` answers "does this account exist" for
  // anyone willing to send one request per address. The earlier defence --
  // that it is unreachable under `enable_confirmations = false` -- held only
  // for the local stack; README.md:132 records that a cloud project requires
  // confirmation by default.
  const unconfirmed = () => new AuthApiError("Email not confirmed", 400, "email_not_confirmed");

  it("answers sign-in identically for an unconfirmed and an unknown account", () => {
    const a = mapAuthError(unconfirmed(), "signin");
    const b = mapAuthError(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"), "signin");
    expect(a.code).toBe("invalid_credentials");
    expect(a.code).toBe(b.code);
    expect(a.mapping.status).toBe(b.mapping.status);
  });

  it("keeps the actionable code on signup, where existence is unavoidable", () => {
    expect(mapAuthError(unconfirmed(), "signup").code).toBe("email_not_confirmed");
  });

  it("leaves every other code untouched by the surface", () => {
    for (const code of ["invalid_credentials", "weak_password", "over_request_rate_limit", "email_exists"]) {
      const err = new AuthApiError("x", 400, code);
      expect(mapAuthError(err, "signin").code).toBe(mapAuthError(err, "signup").code);
    }
  });
});

describe("isAuthErrorCode", () => {
  it.each(AUTH_ERROR_CODES)("accepts %s", (code) => {
    expect(isAuthErrorCode(code)).toBe(true);
  });

  it.each([
    ["a crafted phishing sentence", "Your account is locked, call 555-0100"],
    ["markup", "<script>alert(1)</script>"],
    ["a GoTrue message that used to be reflected", "Invalid login credentials"],
    ["an unmapped GoTrue code", "captcha_failed"],
    ["the empty string", ""],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isAuthErrorCode(value)).toBe(false);
  });
});

describe("copy", () => {
  /**
   * The invariant that makes ``t(`auth.errors.${code}`)`` safe.
   *
   * The page builds that key from a value the mapper produced, so TypeScript
   * cannot check it and i18next does not throw on a miss — it returns the key
   * path, and the user reads "auth.errors.unknown" inside the alert box. This
   * is the only thing standing between a forgotten translation and that.
   */
  it.each(LOCALES)("resolves every code in %s", (locale) => {
    const t = getT(locale);
    const missing = AUTH_ERROR_CODES.filter((code) => {
      const key = `auth.errors.${code}`;
      const value = t(key);
      return value === key || value.trim() === "";
    });
    expect(missing, `codes with no ${locale} translation`).toEqual([]);
  });

  it.each(LOCALES)("never names the account in the %s invalid-credentials copy", (locale) => {
    // F8's second half. The mechanism can be right and the wording can still
    // enumerate: "no account with that email" is the exact string this fix
    // exists to stop the app from ever saying.
    const copy = getT(locale)("auth.errors.invalid_credentials").toLowerCase();
    for (const tell of ["no account", "not found", "does not exist", "nie istnieje", "nie znaleziono"]) {
      expect(copy, `"${tell}" enumerates accounts`).not.toContain(tell);
    }
  });
});
