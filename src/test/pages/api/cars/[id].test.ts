import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car } from "@/types";

// Mock the two boundaries the route imports. `@/lib/api-errors` is deliberately
// NOT mocked — the whole point of this file is that the route reaches the real
// mapper, which is precisely what the original code failed to do.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/cars", () => ({
  getCarById: vi.fn(),
  updateCar: vi.fn(),
  deleteCar: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { getCarById, updateCar, deleteCar } from "@/lib/services/cars";
import { toServiceError } from "@/lib/services/errors";
import { PATCH, DELETE } from "@/pages/api/cars/[id]";

/**
 * Route wiring, not mapping.
 *
 * `src/test/lib/api-errors.test.ts` proves a `22P02` maps to 400. This file
 * proves the route actually asks — which is the bug that was here: a fault
 * reached an inline `.catch` that answered 404 and told nobody. A green mapper
 * behind an unreached call site is worth nothing.
 */

const CAR_ID = "3f1a2b4c-5d6e-4f70-8901-234567890abc";

const FIXTURE_CAR: Car = {
  id: CAR_ID,
  user_id: "user-1",
  brand: "Toyota",
  model: "Corolla",
  production_year: "2018",
  registration_number: "ABC 1234",
  engine_type: "diesel",
  engine_capacity: "1998cc",
  engine_power: "120hp",
  engine_code: "1ND-TV",
  vin_number: "JTDBR32E520012345",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

interface CtxOptions {
  /** `null` means the route matched with no `id` param at all. */
  id?: string | null;
  json?: () => Promise<unknown>;
}

// Extends the chat.test.ts recipe with the layer these routes need: `cars/*`
// self-authenticates through `supabase.auth.getUser()` rather than reading
// `locals.user`, so the client mock — not the context — carries the session.
function makeContext({ id = CAR_ID, json = () => Promise.resolve({ brand: "Honda" }) }: CtxOptions = {}): APIContext {
  return {
    // Passing `undefined` here would not work: a destructuring default replaces
    // it, so the param would silently be the valid fixture id instead of absent.
    params: id === null ? {} : { id },
    request: { headers: new Headers(), json },
    cookies: { get: () => undefined, delete: () => undefined, set: () => undefined },
  } as unknown as APIContext;
}

function mockSupabase(user: { id: string } | null = { id: "user-1" }): SupabaseClient {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
  } as unknown as SupabaseClient;
}

function readJson(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

describe("/api/cars/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createClient).mockReturnValue(mockSupabase());
    vi.mocked(updateCar).mockResolvedValue(FIXTURE_CAR);
    vi.mocked(deleteCar).mockResolvedValue(true);
    // Silence the structured log line; its content is asserted in
    // src/test/lib/api-errors.test.ts.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each([
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ])("%s", (_method, handler) => {
    it("404 when the car is absent — absence still works", async () => {
      vi.mocked(getCarById).mockResolvedValue(null);

      const res = await handler(makeContext());

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Not found" });
    });

    it("400, not 404, for a malformed uuid the service never sees", async () => {
      const res = await handler(makeContext({ id: "abc" }));

      expect(res.status).toBe(400);
      // The service must not be reached at all: letting `abc` through to
      // PostgREST is what produced the 22P02 this guard exists to pre-empt.
      expect(getCarById).not.toHaveBeenCalled();
    });

    it("400 when the path parameter is missing entirely", async () => {
      const res = await handler(makeContext({ id: null }));

      expect(res.status).toBe(400);
      expect(getCarById).not.toHaveBeenCalled();
    });

    it("400, not 404, when the lookup faults with 22P02", async () => {
      vi.mocked(getCarById).mockRejectedValue(
        toServiceError({ code: "22P02", message: "invalid input syntax for type uuid" }, "getCarById"),
      );

      const res = await handler(makeContext());

      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({ error: "Invalid request" });
    });

    it("503, not 404, when the database is unreachable", async () => {
      // The headline case. This exact request used to answer
      // `404 {"error":"Not found"}` — a dead database reading to the user as
      // "your car does not exist", and to the operator as nothing at all.
      vi.mocked(getCarById).mockRejectedValue(
        toServiceError({ code: "", message: "TypeError: fetch failed" }, "getCarById"),
      );

      const res = await handler(makeContext());

      expect(res.status).toBe(503);
      expect(await readJson(res)).toEqual({ error: "Service unavailable" });
    });

    it("500, not 404, when a policy refuses the read", async () => {
      // 42501 reaches here only when a policy or GRANT is misconfigured — the
      // session was already resolved by supabase.auth.getUser() above. That is
      // an operator error the caller cannot act on, so 500 rather than 401.
      vi.mocked(getCarById).mockRejectedValue(
        toServiceError({ code: "42501", message: "permission denied for table cars" }, "getCarById"),
      );

      const res = await handler(makeContext());

      expect(res.status).toBe(500);
      expect(await readJson(res)).toEqual({ error: "Server error" });
    });

    it("401 when the JWT itself failed verification", async () => {
      // The code that does mean "your session is gone", kept distinct from the
      // one above so the two cannot drift back together.
      vi.mocked(getCarById).mockRejectedValue(
        toServiceError({ code: "PGRST301", message: "JWT expired" }, "getCarById"),
      );

      expect((await handler(makeContext())).status).toBe(401);
    });

    it("keeps Postgres text out of the body", async () => {
      vi.mocked(getCarById).mockRejectedValue(
        toServiceError(
          {
            code: "42501",
            message: 'permission denied for table "cars" — policy "cars_select_own"',
            details: "Failing row contains (3f1a, user-1).",
            hint: null,
          },
          "getCarById",
        ),
      );

      const body = await (await handler(makeContext())).text();

      expect(body).not.toContain("cars_select_own");
      expect(body).not.toContain("permission denied");
      expect(body).not.toContain("Failing row");
    });

    it("logs the failure instead of discarding it", async () => {
      // The other half of the original defect: the old inline catch produced no
      // server-side trace whatsoever.
      vi.mocked(getCarById).mockRejectedValue(toServiceError({ code: "57014", message: "timeout" }, "getCarById"));

      await handler(makeContext());

      expect(console.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(console.error).mock.calls[0][0]).toMatchObject({
        event: "api_error",
        route: "/api/cars/[id]",
        code: "57014",
        status: 503,
      });
    });
  });

  describe("PATCH", () => {
    beforeEach(() => {
      vi.mocked(getCarById).mockResolvedValue(FIXTURE_CAR);
    });

    it("200 on the happy path — the success shape is unchanged", async () => {
      const res = await PATCH(makeContext());

      expect(res.status).toBe(200);
      expect(await readJson(res)).toEqual({ car: FIXTURE_CAR });
    });

    it("maps a fault from the update itself, not just from the pre-check", async () => {
      vi.mocked(updateCar).mockRejectedValue(
        toServiceError({ code: "23514", message: "violates check constraint" }, "updateCar"),
      );

      const res = await PATCH(makeContext());

      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({ error: "Invalid request" });
    });

    it("500 for a plain JS bug in the service, without leaking the stack", async () => {
      vi.mocked(updateCar).mockRejectedValue(new TypeError("data.map is not a function"));

      const res = await PATCH(makeContext());

      expect(res.status).toBe(500);
      expect(await readJson(res)).toEqual({ error: "Server error" });
    });
  });

  describe("DELETE", () => {
    beforeEach(() => {
      vi.mocked(getCarById).mockResolvedValue(FIXTURE_CAR);
    });

    it("200 on the happy path", async () => {
      const res = await DELETE(makeContext());

      expect(res.status).toBe(200);
      expect(await readJson(res)).toEqual({ success: true });
    });

    it("404 when the delete matched no row", async () => {
      // The zero-row DELETE bug's route-level half: reporting success for a car
      // that is still there would also clear the selected-car cookie.
      vi.mocked(deleteCar).mockResolvedValue(false);

      const res = await DELETE(makeContext());

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Not found" });
    });

    it("maps a fault from the delete itself", async () => {
      vi.mocked(deleteCar).mockRejectedValue(toServiceError({ code: "", message: "fetch failed" }, "deleteCar"));

      expect((await DELETE(makeContext())).status).toBe(503);
    });
  });

  it("401 before anything else when there is no session", async () => {
    vi.mocked(createClient).mockReturnValue(mockSupabase(null));

    const res = await PATCH(makeContext());

    expect(res.status).toBe(401);
    expect(getCarById).not.toHaveBeenCalled();
  });
});
