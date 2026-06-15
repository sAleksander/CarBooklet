import { describe, it, expect, vi } from "vitest";
import type { Car } from "@/types";

// Force a misconfigured server: no OpenRouter key. The `openai` client is
// also stubbed so its constructor does not throw on the empty key at module
// import — that lets us reach (and assert) the explicit guard inside
// createChatStream rather than failing at module evaluation.
vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_KEY: "test-supabase-key",
}));
vi.mock("openai", () => ({
  default: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

import { createChatStream } from "@/lib/services/ai";

const CAR: Car = {
  id: "car-1",
  user_id: "user-1",
  brand: "Toyota",
  model: "Corolla",
  production_year: "2018",
  registration_number: null,
  engine_type: "diesel",
  engine_capacity: "1998cc",
  engine_power: "120hp",
  engine_code: null,
  vin_number: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("createChatStream config guard", () => {
  it("rejects with a generic message (no secret) when the key is not configured", async () => {
    await expect(createChatStream("any prompt", CAR)).rejects.toThrow("OPENROUTER_API_KEY is not configured");
  });
});
