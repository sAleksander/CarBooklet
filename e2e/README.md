# E2E tests

Browser-level tests. Each one protects a named risk from
`context/foundation/test-plan.md` — a test that cannot name its risk should not
be written.

## Running

```bash
docker info                 # Docker must be running
npx supabase start          # local stack; migrations apply automatically
npm run test:e2e            # builds and starts `npm run preview` itself via playwright.config.ts
npm run test:e2e:ui         # same, with the Playwright UI
```

`.dev.vars` needs `SUPABASE_URL` and `SUPABASE_KEY`. The suite now serves the
production build through `astro preview`, which is wrangler-backed: the built
Worker reads its runtime config from `dist/server/.dev.vars`, copied from
`.dev.vars` at build time. Without it the app builds and then serves a
missing-config banner, and every spec dies at sign-in.

`.env` needs `SUPABASE_SERVICE_ROLE_KEY` — the **Secret** key from
`npx supabase status` (newer CLIs print `sb_secret_…` rather than a
`service_role` JWT). It bypasses RLS and is used only to seed and delete test
users. It must point at the local stack, never a cloud project, and must never
be imported from `src/`.

## Conventions

`seed.spec.ts` is the exemplar. Read it before writing or generating a test; its
header comment lists the five conventions in priority order, and the fixtures in
`fixtures/app.ts` carry the rest. The general rules live in the `/10x-e2e`
skill; this file records only what is specific to CarBooklet.

Project-specific things that bite:

- **Pin the locale.** Every accessible name comes from i18n (`t()`), and the
  locale is a `lang` cookie (`src/middleware.ts`). The `signedInPage` fixture
  pins `lang=en`. A name-based locator without that is a coin flip.
- **`getByLabel` matches case-insensitive substrings.** Bare `"Password"` also
  matches the show/hide toggle's `aria-label="Show password"` and dies on strict
  mode. Use `{ exact: true }` for form fields.
- **`getByRole("textbox")` cannot find a password input** — `<input
type="password">` has no implicit ARIA role. `getByLabel` is the tool there,
  despite `getByRole` leading the priority list.
- **Do not wait on a URL after sign-in.** `/api/auth/signin` → `/` →
  `/dashboard` → `/cars` when no car is selected, which is always true for a
  fresh user. Wait for the signed-in _state_ instead (the fixture waits for the
  "Sign out" button).
- **Cleanup is the `user` fixture.** `cars.user_id` and every
  `entries.*.user_id` are `REFERENCES auth.users(id) ON DELETE CASCADE`, so
  deleting the user removes everything the test created. Do not delete rows by
  hand.
- **`getByText` can match Astro's island props, not the page.** In dev, Astro
  serializes each island's props into a hidden `<code>` block, so
  `getByText("some-entry-description")` resolves to that JSON — present whether
  or not the entry ever rendered. A test written that way stays green through
  exactly the data loss it was meant to catch (this bit
  `car-delete-blast-radius.spec.ts` during authoring). Locate rendered content
  by its role — `getByRole("link").filter({ hasText: … })` — not by bare text.
- **Do not click an island's controls as the first act after `goto` — use
  `gotoHydrated`.** `EntriesTabs` is `client:load`; a tab click issued before
  React hydrates hits the DOM but no handler, and the tab silently does not
  change. `gotoHydrated(page, path)` in `fixtures/app.ts` navigates and then
  waits for every island to mount; use it for every in-test navigation. Prefer
  asserting on the default tab (Repairs) where the data is server-rendered. If a
  test genuinely needs another tab, retry the click with `expect(...).toPass()` —
  never a `waitForTimeout`.

  This rule was advisory until the suite moved off `astro dev`. Every spec that
  navigated and then clicked was racing hydration and winning only because the
  dev server was slow to answer; all three failed on first contact with a
  production preview server. If you are tempted to skip the wait because "it
  passes locally", that is exactly the evidence it was passing on.

## The AI / OpenRouter boundary

E2E hits the **real** OpenRouter model by default. No `page.route` interception,
nothing mocked — the decision is fidelity over determinism, and it still holds
for any flow whose point is the server round trip.

Know what that buys and costs. It is a genuine end-to-end path. It is also
non-deterministic in timing, costs free-tier quota (50 requests/day, shared with
the demo), and fails when the model is rate-limited (`test-plan.md` §7 already
flags mass free-model calls as an exposure).

**`ai-progress.spec.ts` is the one deliberate exception.** It stubs
`POST /api/ai/chat` with a canned SSE body and never reaches OpenRouter. Three
reasons, all specific to **R6** (AI progress feedback):

1. What R6 protects is the UI's loading-state transitions. The model's only
   contribution to that is latency — which is exactly what makes a live
   assertion a race rather than a test.
2. `retries: 0` is deliberate, so a rate-limited day would turn the spec red for
   a reason unrelated to the risk.
3. `pre-demo-fixes` rules `OPENROUTER_API_KEY` out of CI entirely, so a
   real-model spec could not run in the `e2e` job at all.

The stub also buys coverage the real model cannot: a turn that is open with no
tokens yet, which is the exact window a screen-reader user used to get nothing
in. If you add a spec that asserts on the _answer_ rather than the transitions,
that one belongs on the real model.

The accessibility gap this section used to describe is now closed.
`StreamingText.tsx` rendered its cursor as `<span className="animate-pulse">▋</span>`
with no role, no `aria-live` and no accessible name, so no role locator could see
it and the composer's "Stop" label was the only accessible progress signal.
`ChatThread` now carries a persistent `role="status" aria-live="polite"` region,
named `aiChat.progress`, which announces state transitions only. Locate it by
role **and name** — the error line is also `role="status"`, and a bare
`getByRole("status")` fails strict mode whenever both are present.

## Known UI issues these tests work around

- **Duplicate accessible name "Add car"** — the list trigger (`cars.addCar`) and
  the form submit (`cars.form.addCar`) are identical. It resolves today only
  because `CarList` hides the trigger while the form is open. Worth fixing.
