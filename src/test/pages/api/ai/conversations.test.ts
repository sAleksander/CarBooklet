import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ServiceError } from "@/lib/services/errors";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/conversations", () => ({ deleteConversation: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { deleteConversation } from "@/lib/services/conversations";
import { DELETE } from "@/pages/api/ai/conversations/[id]";

const FAKE_SUPABASE = {} as unknown as SupabaseClient;
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface CtxOptions {
  user?: { id: string } | null;
  id?: string;
}

function makeContext({ user = { id: "user-1" }, id = UUID }: CtxOptions = {}): APIContext {
  return {
    locals: { user },
    params: { id },
    request: { headers: new Headers() },
    cookies: {},
  } as unknown as APIContext;
}

function readJson(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

describe("DELETE /api/ai/conversations/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createClient).mockReturnValue(FAKE_SUPABASE);
    vi.mocked(deleteConversation).mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("401 when there is no authenticated user", async () => {
    const res = await DELETE(makeContext({ user: null }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "Unauthorized" });
    // Nothing is attempted against the database for an anonymous caller.
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it("400 when the id is not a uuid, without reaching the database", async () => {
    const res = await DELETE(makeContext({ id: "not-a-uuid" }));

    expect(res.status).toBe(400);
    // The distinction this validation exists for: a malformed id is the client's
    // mistake (400), not a missing row (404) and not a broken server (500).
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it("503 when the Supabase client cannot be created", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const res = await DELETE(makeContext());

    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "Service unavailable" });
  });

  it("404 when the conversation is not the caller's", async () => {
    // A refused cross-user delete matches zero rows, which the service reports
    // as `false` rather than as an error.
    vi.mocked(deleteConversation).mockResolvedValue(false);

    const res = await DELETE(makeContext());

    expect(res.status).toBe(404);
    // 404 not 403: whether the id exists is not the caller's business.
    expect(await readJson(res)).toEqual({ error: "Not found" });
  });

  it("200 and deletes the caller's own conversation", async () => {
    const res = await DELETE(makeContext());

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ success: true });
    expect(deleteConversation).toHaveBeenCalledWith(FAKE_SUPABASE, UUID, "user-1");
  });

  it("maps a database fault through the shared error boundary", async () => {
    vi.mocked(deleteConversation).mockRejectedValue(
      new ServiceError("connection refused", "", null, null, "deleteConversation"),
    );

    const res = await DELETE(makeContext());

    // `""` is the transport-fault code supabase-js reports; the table maps it
    // to 503, and nothing Postgres authored reaches the body.
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "Service unavailable" });
  });
});
