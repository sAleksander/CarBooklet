import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapErrorCode, logApiError, apiErrorResponse, type ErrorMapping } from "@/lib/api-errors";
import { toServiceError } from "@/lib/services/errors";

/**
 * The code→status table is the specification for this whole change, so it gets a
 * case per row. A code that silently falls through to the default branch is not
 * a cosmetic slip: it is the same failure as the swallow this change removes,
 * relocated one layer up.
 *
 * The four property assertions at the bottom matter more than any individual
 * row. Rows can be argued about; "no Postgres text reaches the client" and "404
 * means one thing" are the guarantees.
 */

/** Every argument `console.error` was called with, per call. */
let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CTX = { route: "/api/entries/repair", method: "POST", userId: "user-1" };

/** The one field of a log line that is not a plain value. */
function payload(): Record<string, unknown> {
  expect(logged).toHaveLength(1);
  // A single object, not a string plus a second argument — Cloudflare indexes
  // the top-level keys of one logged object and does not merge a second
  // positional argument into them. Asserting the arity is asserting the
  // difference between a queryable field and an opaque blob.
  expect(logged[0]).toHaveLength(1);
  return logged[0][0] as Record<string, unknown>;
}

describe("mapErrorCode", () => {
  // One row per row of the plan's table, in table order.
  const TABLE: [code: string, status: number, message: string, label: string][] = [
    ["22P02", 400, "Invalid request", "malformed uuid"],
    ["22008", 400, "Invalid request", "bad date"],
    ["22003", 400, "Invalid request", "numeric out of range"],
    ["23502", 400, "Invalid request", "not-null violation"],
    ["23514", 400, "Invalid request", "check violation"],
    ["23503", 404, "Not found", "FK violation"],
    ["42501", 401, "Unauthorized", "RLS denial"],
    ["PGRST301", 401, "Unauthorized", "JWT failure"],
    ["PGRST116", 500, "Server error", "more than one row under maybeSingle"],
    ["PGRST204", 500, "Server error", "schema cache"],
    ["57014", 503, "Service unavailable", "statement timeout"],
    ["", 503, "Service unavailable", "transport / DNS / abort"],
  ];

  it.each(TABLE)("maps %s (%s) to %i", (code, status, message) => {
    expect(mapErrorCode(code)).toEqual({ status, message });
  });

  it("falls back to 500 for a code that is not in the table", () => {
    // The thirteenth row. A code nobody anticipated is a server-side unknown,
    // and answering it with anything more specific would be a guess.
    expect(mapErrorCode("40001")).toEqual({ status: 500, message: "Server error" });
  });

  it("never produces 404 except for 23503", () => {
    // The assertion that encodes the entire point of the change. `404` used to
    // be what a dead database looked like; from here it means one thing only —
    // the row does not exist or is not yours.
    const codes = [...TABLE.map(([code]) => code), "40001", "XX000", "PGRST000", "unknown"];

    for (const code of codes) {
      if (mapErrorCode(code).status === 404) {
        expect(code).toBe("23503");
      }
    }
    // Positive control: without this, a mapper that returned 404 for nothing at
    // all would satisfy the loop above.
    expect(mapErrorCode("23503").status).toBe(404);
  });

  it("draws every client message from a closed set of four literals", () => {
    // Asserted against the mapper, not against TABLE — a fixture compared to
    // itself proves nothing. The closed set is what guarantees no future row can
    // interpolate a code, a column name, or anything else Postgres authored.
    const ALLOWED = ["Invalid request", "Unauthorized", "Not found", "Server error", "Service unavailable"];
    const codes = [...TABLE.map(([code]) => code), "40001", "XX000", "PGRST000", "unknown"];

    for (const code of codes) {
      expect(ALLOWED).toContain(mapErrorCode(code).message);
    }
  });
});

describe("logApiError", () => {
  const mapping: ErrorMapping = { status: 401, message: "Unauthorized" };

  it("emits one object carrying the operator's full detail", () => {
    const err = toServiceError(
      {
        code: "42501",
        message: 'new row violates row-level security policy for table "repair_entries"',
        details: "Failing row contains (a3f, 9c1, 2026-01-01, 1000).",
        hint: "Check the WITH CHECK clause",
      },
      "createRepairEntry",
    );

    logApiError(err, CTX, mapping);

    expect(payload()).toEqual({
      event: "api_error",
      route: "/api/entries/repair",
      method: "POST",
      userId: "user-1",
      op: "createRepairEntry",
      status: 401,
      code: "42501",
      message: 'new row violates row-level security policy for table "repair_entries"',
      details: "Failing row contains (a3f, 9c1, 2026-01-01, 1000).",
      hint: "Check the WITH CHECK clause",
    });
  });

  it("keeps event constant so one query returns every failure app-wide", () => {
    logApiError(toServiceError({ code: "57014", message: "timeout" }, "getCars"), CTX, mapping);

    expect(payload().event).toBe("api_error");
  });

  it("logs a non-ServiceError with an empty code and no op", () => {
    // A JS bug in a route still deserves a queryable line; it just has no
    // PostgREST detail to carry.
    logApiError(new TypeError("cars.map is not a function"), CTX, mapping);

    expect(payload()).toMatchObject({
      op: null,
      code: "",
      message: "cars.map is not a function",
      details: null,
      hint: null,
    });
  });

  it.each([
    ["a thrown string", "boom", "boom"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a plain object", { why: "no" }, '{"why":"no"}'],
  ])("survives %s being thrown", (_label, thrown, expected) => {
    expect(() => {
      logApiError(thrown, CTX, mapping);
    }).not.toThrow();
    expect(payload().message).toBe(expected);
  });

  it("survives a value that cannot be serialized at all", () => {
    // An error handler that can itself fail turns a diagnosable 500 into an
    // unhandled rejection.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      logApiError(circular, CTX, mapping);
    }).not.toThrow();
    expect(payload().message).toBe("<unserializable thrown value>");
  });

  it("carries userId through as undefined when there is no session", () => {
    logApiError(new Error("boom"), { route: "/api/cars", method: "GET" }, mapping);

    expect(payload()).toMatchObject({ userId: undefined, route: "/api/cars" });
  });
});

describe("apiErrorResponse", () => {
  it("answers with the mapped status and the generic message", async () => {
    const res = apiErrorResponse(toServiceError({ code: "22P02", message: "invalid input syntax" }, "getCarById"), CTX);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });

  it("does not leak Postgres text into the response body", async () => {
    // The leak this change exists to close: constraint, policy and table names
    // were rendered verbatim into 14 DOM elements.
    const err = toServiceError(
      {
        code: "42501",
        message: 'new row violates row-level security policy "entries_insert_own" for table "repair_entries"',
        details: "Failing row contains (a3f, 9c1, user-1, 2026-01-01).",
        hint: "Check the WITH CHECK clause on repair_entries",
      },
      "createRepairEntry",
    );

    const body = await apiErrorResponse(err, CTX).text();

    expect(body).not.toContain("entries_insert_own");
    expect(body).not.toContain("repair_entries");
    expect(body).not.toContain("row-level security");
    expect(body).toBe(JSON.stringify({ error: "Unauthorized" }));
  });

  it("never puts details in the body, however harmless it looks", async () => {
    // `23502`'s details carries the entire failing row, `user_id` included.
    const err = toServiceError(
      {
        code: "23502",
        message: 'null value in column "description" violates not-null constraint',
        details: "Failing row contains (a3f, 9c1, user-1, 2026-01-01, 1000, null).",
        hint: null,
      },
      "createRepairEntry",
    );

    const body = await apiErrorResponse(err, CTX).text();

    expect(body).not.toContain("Failing row");
    expect(body).not.toContain("user-1");
    expect(payload().details).toBe("Failing row contains (a3f, 9c1, user-1, 2026-01-01, 1000, null).");
  });

  it.each([
    ["a plain Error", new Error("cars.map is not a function")],
    ["a TypeError", new TypeError("undefined is not an object")],
    ["a thrown string", "boom"],
    ["null", null],
    ["undefined", undefined],
  ])("maps %s to a 500 without throwing", async (_label, thrown) => {
    const res = apiErrorResponse(thrown, CTX);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server error" });
  });

  it("distinguishes a transport fault from a stray TypeError, though both log code ''", async () => {
    // The one place where "is it a ServiceError" changes the answer rather than
    // just the detail. An empty code *from a service* means supabase-js could
    // not reach the database — a 503. An empty code standing in for a JS bug in
    // a route means nothing of the sort.
    const transport = apiErrorResponse(
      toServiceError({ code: "", message: "TypeError: fetch failed" }, "getCars"),
      CTX,
    );
    expect(transport.status).toBe(503);
    expect(await transport.json()).toEqual({ error: "Service unavailable" });

    logged = [];
    const bug = apiErrorResponse(new TypeError("fetch failed"), CTX);
    expect(bug.status).toBe(500);
    expect(payload().code).toBe("");
  });

  it("logs exactly once per response", () => {
    apiErrorResponse(toServiceError({ code: "57014", message: "canceling statement" }, "getCars"), CTX);

    expect(payload()).toMatchObject({ status: 503, code: "57014", op: "getCars" });
  });
});
