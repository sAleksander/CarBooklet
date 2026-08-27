import { describe, it, expect } from "vitest";
import { ServiceError, toServiceError, isServiceError } from "@/lib/services/errors";

/**
 * The service layer's error contract, pinned before anything depends on it.
 *
 * Everything downstream — the code→status mapper, every route catch block, the
 * structured log line — reads the four fields asserted here. `toServiceError`
 * exists because `throw new Error(res.error.message)` threw three of them away,
 * so "the fields survive the round trip" is the whole point rather than a detail.
 */
describe("ServiceError", () => {
  const postgrestError = {
    code: "23502",
    message: 'null value in column "description" violates not-null constraint',
    details: "Failing row contains (a3f, 9c1, 2026-01-01, 1000, null, null).",
    hint: null,
  };

  describe("toServiceError", () => {
    it("preserves every field PostgREST reported", () => {
      const err = toServiceError(postgrestError, "createRepairEntry");

      expect(err.code).toBe("23502");
      expect(err.message).toBe(postgrestError.message);
      expect(err.details).toBe(postgrestError.details);
      expect(err.op).toBe("createRepairEntry");
    });

    it("round-trips a transport fault with an empty code rather than coercing it", () => {
      // supabase-js catches fetch failures, DNS errors and aborts internally and
      // reports them as a populated error with no code — it never rejects. `""`
      // is therefore a real, mappable value (503), and turning it into `null` or
      // a placeholder would lose the one signal that says "the database is
      // unreachable" rather than "the database refused".
      const err = toServiceError({ code: "", message: "TypeError: fetch failed" }, "getCars");

      expect(err.code).toBe("");
      expect(err.message).toBe("TypeError: fetch failed");
    });

    it("treats an absent code the same as an empty one", () => {
      expect(toServiceError({ message: "boom" }, "getCars").code).toBe("");
    });

    it("normalises empty details and hint to null", () => {
      // PostgREST sends `""` when it has nothing to say. In a log line an empty
      // string reads as "there was a detail and it was blank"; null reads as
      // "there was none".
      const err = toServiceError({ code: "42501", message: "denied", details: "", hint: "" }, "createCar");

      expect(err.details).toBeNull();
      expect(err.hint).toBeNull();
    });

    it("keeps a hint when PostgREST offers one", () => {
      const err = toServiceError(
        { code: "PGRST204", message: "no column", hint: "Reload the schema cache" },
        "getCars",
      );

      expect(err.hint).toBe("Reload the schema cache");
    });

    it("names itself, so a serialized log line identifies its own layer", () => {
      expect(toServiceError(postgrestError, "createRepairEntry").name).toBe("ServiceError");
    });
  });

  describe("isServiceError", () => {
    it("narrows a ServiceError", () => {
      const err: unknown = toServiceError(postgrestError, "createRepairEntry");

      expect(isServiceError(err)).toBe(true);
      // The narrowing itself is the point — this line does not compile without it.
      if (isServiceError(err)) expect(err.code).toBe("23502");
    });

    it.each([
      ["a plain Error", new Error("boom")],
      ["a string", "23502"],
      ["null", null],
      ["undefined", undefined],
      ["a bare object wearing the right shape", { code: "23502", message: "boom", op: "getCars" }],
    ])("rejects %s", (_label, value) => {
      // The last case matters most: a duck-typed lookalike must not pass, or the
      // route layer would read `details` off something that never came from a
      // service call.
      expect(isServiceError(value)).toBe(false);
    });
  });

  it("is still an Error, so existing catch handling keeps working", () => {
    const err = toServiceError(postgrestError, "createRepairEntry");

    // Load-bearing for the phases that follow: route catch blocks are converted
    // one file at a time, so an un-converted one must keep behaving as it did.
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ServiceError);
    expect(String(err)).toContain("ServiceError");
  });
});
