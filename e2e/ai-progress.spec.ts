import { test, expect, gotoHydrated } from "./fixtures/app";

/**
 * R6 — AI progress feedback (test-plan.md §2, risk 6).
 *
 * The claim under test is the PRD's: "Any AI assistant query must display
 * continuous visible progress to the user from submission through to response
 * delivery" (prd.md:92), which names the absence of that feedback a regression.
 * The assertion is therefore about the *presence of progress* and never about
 * the answer's content — asserting on the model's words is the anti-pattern
 * test-plan.md:87 calls out by name, alongside `waitForTimeout`.
 *
 * ## Why this one spec stubs the model
 *
 * `e2e/README.md` records a deliberate decision that E2E hits the real
 * OpenRouter model with nothing mocked, and that decision still stands for
 * flows whose point is the server round trip. This spec is the exception, for
 * three reasons:
 *
 * 1. What R6 protects is the UI's loading-state transitions. The model's
 *    contribution to that is latency, and latency is exactly what makes a live
 *    assertion a race.
 * 2. `retries: 0` is deliberate (playwright.config.ts:16), so a rate-limited
 *    day would turn this red for a reason unrelated to the risk. The free tier
 *    is 50 requests/day and the demo shares it.
 * 3. `change.md` rules `OPENROUTER_API_KEY` out of CI entirely. A real-model
 *    spec could not run in the `e2e` job at all.
 *
 * The stub also buys coverage the real model cannot: a turn that is open with
 * no tokens yet, which is precisely the window where a sighted user sees the
 * caret and a screen-reader user used to get nothing.
 */

/** One SSE turn, in the frame shape src/lib/chat.ts:24-31 defines. */
const TURN = [
  'data: {"meta":{"conversation_id":"11111111-1111-4111-8111-111111111111"}}\n\n',
  'data: {"text":"5W-30, "}\n\n',
  'data: {"text":"per the last oil change."}\n\n',
  'data: {"done":"complete"}\n\n',
  "data: [DONE]\n\n",
];

test("R6 — a streamed answer announces its start and its end", async ({ signedInPage, runId }) => {
  const page = signedInPage;

  // /ai-chat bounces to /cars when no car is selected, so the thread needs one.
  const res = await page.request.post("/api/cars", {
    data: {
      brand: "Toyota",
      model: `AiProgress-${runId}`,
      production_year: "2020",
      engine_type: "gas",
      engine_capacity: "1.6L",
      engine_power: "132hp",
    },
  });
  expect(res.status(), `seeding the car failed: ${await res.text()}`).toBe(201);
  const { car } = (await res.json()) as { car: { id: string } };

  await gotoHydrated(page, "/cars");
  const card = page.getByRole("listitem").filter({ hasText: `AiProgress-${runId}` });
  await card.getByRole("button", { name: "Select" }).click();
  await expect(card.getByRole("button", { name: "Active" })).toBeVisible();

  // The stub. Held open deliberately: the body is released frame by frame so the
  // in-flight state is observable, which a completed response would not be.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ai/chat", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: TURN.join(""),
    });
  });

  await gotoHydrated(page, `/ai-chat?new=1&car=${car.id}`);

  await page.getByRole("textbox", { name: "Ask anything about your car…" }).fill("Which oil does it take?");
  await page.getByRole("button", { name: "Ask" }).click();

  // 1. Progress is announced before a single token has arrived. This is the
  //    window the old UI had no accessible signal for at all.
  const progress = page.getByRole("status", { name: "Assistant reply status" });
  await expect(progress).toHaveText("Assistant is replying…");

  // 2. The corroborating visible signal, and the only one that existed before.
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  release();

  // 3. The terminal transition — the half a region living inside StreamingText
  //    could never report, because that component unmounts at this moment.
  await expect(progress).toHaveText("Reply complete");
  await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
});
