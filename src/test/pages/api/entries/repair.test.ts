import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, RepairEntry } from "@/types";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/cars", () => ({ getCarById: vi.fn() }));
vi.mock("@/lib/services/entries", () => ({
  getRepairEntries: vi.fn(),
  createRepairEntry: vi.fn(),
  updateRepairEntry: vi.fn(),
  deleteRepairEntry: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { getRepairEntries, createRepairEntry, updateRepairEntry, deleteRepairEntry } from "@/lib/services/entries";
import { toServiceError } from "@/lib/services/errors";
import { GET, POST, PATCH, DELETE } from "@/pages/api/entries/repair";

/**
 * One entry route covered thoroughly rather than four covered shallowly.
 *
 * `repair`, `oil-change`, `inspection` and `insurance` are structurally
 * identical — same four handlers, same ownership pre-check, same catch shape —
 * and Phase 4 applied the same mechanical transform to all four. What is worth
 * pinning is the behaviour that transform is *supposed* to produce, and that is
 * the same behaviour in every file.
 */

const CAR_ID = "3f1a2b4c-5d6e-4f70-8901-234567890abc";
const ENTRY_ID = "7c2d4e6f-8a90-4b12-9c34-567890abcdef";

const FIXTURE_CAR = { id: CAR_ID, user_id: "user-1" } as Car;
const FIXTURE_ENTRY = { id: ENTRY_ID, entry_type: "repair" } as RepairEntry;

const VALID_POST = {
  car_id: CAR_ID,
  conducted_at: "2026-01-01",
  mileage: 1000,
  description: "Brake pads",
  cause: null,
};

const VALID_PATCH = { ...VALID_POST, id: ENTRY_ID, car_id: undefined };

interface CtxOptions {
  user?: { id: string } | null;
  url?: string;
  json?: () => Promise<unknown>;
}

// These routes read `locals.user` like `chat.ts` does, so the recipe from
// `src/test/pages/api/ai/chat.test.ts` transfers unchanged apart from the URL,
// which GET and DELETE read their parameters from.
function makeContext({
  user = { id: "user-1" },
  url = `http://localhost/api/entries/repair?car_id=${CAR_ID}`,
  json = () => Promise.resolve(VALID_POST),
}: CtxOptions = {}): APIContext {
  return {
    locals: { user },
    request: { url, headers: new Headers(), json },
    cookies: {},
  } as unknown as APIContext;
}

function readJson(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

describe("/api/entries/repair", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createClient).mockReturnValue({} as unknown as SupabaseClient);
    vi.mocked(getCarById).mockResolvedValue(FIXTURE_CAR);
    vi.mocked(getRepairEntries).mockResolvedValue([]);
    vi.mocked(createRepairEntry).mockResolvedValue(FIXTURE_ENTRY);
    vi.mocked(updateRepairEntry).mockResolvedValue(FIXTURE_ENTRY);
    vi.mocked(deleteRepairEntry).mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ownership failure", () => {
    it("404, not 403, when the car belongs to someone else", async () => {
      // The convention change. `403 Forbidden` confirms the car exists, which is
      // the enumeration answer the cars routes already refuse to give. Nothing
      // asserted this either way before, in either direction.
      vi.mocked(getCarById).mockResolvedValue(null);

      const res = await POST(makeContext());

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Not found" });
    });

    it("does not write the entry when ownership fails", async () => {
      vi.mocked(getCarById).mockResolvedValue(null);

      await POST(makeContext());

      expect(createRepairEntry).not.toHaveBeenCalled();
    });

    // Deliberately not tested here: "a foreign car answers exactly as a
    // nonexistent one does". At this layer the two are the *same* mock — a
    // foreign car and a missing car both reach the route as `getCarById → null`,
    // because the service filters on `user_id` and cannot tell them apart
    // either. A test comparing them here would be comparing one scenario to
    // itself. The real oracle is `integration/isolation-cars.test.ts`, which
    // asserts it against a live database with two actual users.
  });

  describe("fault mapping", () => {
    it("maps by code rather than collapsing to a blanket 500", async () => {
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "23514", message: "violates check constraint mileage_positive" }, "createRepairEntry"),
      );

      const res = await POST(makeContext());

      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({ error: "Invalid request" });
    });

    it("answers 503 when the database is unreachable", async () => {
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "", message: "TypeError: fetch failed" }, "createRepairEntry"),
      );

      expect((await POST(makeContext())).status).toBe(503);
    });

    it("answers 500 when a policy refuses the write", async () => {
      // Not 401: middleware.ts already resolved locals.user, so a live 42501 is
      // a policy or GRANT misconfiguration rather than a dead session.
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "42501", message: "permission denied" }, "createRepairEntry"),
      );

      expect((await POST(makeContext())).status).toBe(500);
    });

    it("answers 401 when the JWT itself failed verification", async () => {
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "PGRST301", message: "JWT expired" }, "createRepairEntry"),
      );

      expect((await POST(makeContext())).status).toBe(401);
    });

    it("still answers 500 for a code with no mapping", async () => {
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "40001", message: "serialization failure" }, "createRepairEntry"),
      );

      const res = await POST(makeContext());

      expect(res.status).toBe(500);
      expect(await readJson(res)).toEqual({ error: "Server error" });
    });

    it("keeps Postgres text out of the body — this one renders in the DOM", async () => {
      // `RepairForm`'s error paragraph renders `json.error` verbatim. Until now
      // that paragraph could display a constraint name and a failing row.
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError(
          {
            code: "23502",
            message: 'null value in column "description" of relation "repair_entries"',
            details: "Failing row contains (7c2d, user-1, 2026-01-01, 1000, null).",
            hint: null,
          },
          "createRepairEntry",
        ),
      );

      const body = await (await POST(makeContext())).text();

      expect(body).not.toContain("repair_entries");
      expect(body).not.toContain("description");
      expect(body).not.toContain("Failing row");
      expect(body).not.toContain("user-1");
      expect(body).toBe(JSON.stringify({ error: "Invalid request" }));
    });
  });

  describe("every handler reaches the mapper", () => {
    // The transform was mechanical across sixteen catch blocks; this is what
    // proves none of the four in this file was missed.
    const fault = () => toServiceError({ code: "57014", message: "canceling statement" }, "op");

    it("GET", async () => {
      vi.mocked(getRepairEntries).mockRejectedValue(fault());
      expect((await GET(makeContext())).status).toBe(503);
    });

    it("POST", async () => {
      vi.mocked(createRepairEntry).mockRejectedValue(fault());
      expect((await POST(makeContext())).status).toBe(503);
    });

    it("PATCH", async () => {
      vi.mocked(updateRepairEntry).mockRejectedValue(fault());
      expect((await PATCH(makeContext({ json: () => Promise.resolve(VALID_PATCH) }))).status).toBe(503);
    });

    it("DELETE", async () => {
      vi.mocked(deleteRepairEntry).mockRejectedValue(fault());
      const url = `http://localhost/api/entries/repair?id=${ENTRY_ID}`;
      expect((await DELETE(makeContext({ url }))).status).toBe(503);
    });
  });

  describe("logging", () => {
    it("names the route and the failing service function", async () => {
      // `op` is what sends an operator to the right function; a wrong one is
      // worse than none.
      vi.mocked(createRepairEntry).mockRejectedValue(
        toServiceError({ code: "57014", message: "canceling statement" }, "createRepairEntry"),
      );

      await POST(makeContext());

      expect(vi.mocked(console.error).mock.calls[0][0]).toMatchObject({
        event: "api_error",
        route: "/api/entries/repair",
        method: "POST",
        op: "createRepairEntry",
        userId: "user-1",
        status: 503,
      });
    });
  });

  describe("success paths are unchanged", () => {
    it("201 on create", async () => {
      const res = await POST(makeContext());

      expect(res.status).toBe(201);
      expect(await readJson(res)).toEqual({ entry: FIXTURE_ENTRY });
    });

    it("204 on delete", async () => {
      const url = `http://localhost/api/entries/repair?id=${ENTRY_ID}`;

      expect((await DELETE(makeContext({ url }))).status).toBe(204);
    });

    it("404 when the entry to update is absent", async () => {
      vi.mocked(updateRepairEntry).mockResolvedValue(null);

      const res = await PATCH(makeContext({ json: () => Promise.resolve(VALID_PATCH) }));

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Entry not found" });
    });

    it("401 before anything else when there is no session", async () => {
      const res = await POST(makeContext({ user: null }));

      expect(res.status).toBe(401);
      expect(getCarById).not.toHaveBeenCalled();
    });
  });
});
