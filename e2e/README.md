# E2E tests

Browser-level tests. Each one protects a named risk from
`context/foundation/test-plan.md` — a test that cannot name its risk should not
be written.

## Running

```bash
docker info                 # Docker must be running
npx supabase start          # local stack; migrations apply automatically
npm run test:e2e            # starts `npm run dev` itself via playwright.config.ts
npm run test:e2e:ui         # same, with the Playwright UI
```

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
- **Do not click an island's controls as the first act after `goto`.**
  `EntriesTabs` is `client:load`; a tab click issued before React hydrates hits
  the DOM but no handler, and the tab silently does not change. Prefer asserting
  on the default tab (Repairs) where the data is server-rendered. If a test
  genuinely needs another tab, retry the click with `expect(...).toPass()` —
  never a `waitForTimeout`.

## The AI / OpenRouter boundary

E2E hits the **real** OpenRouter model. No `page.route` interception, nothing
mocked — the decision is fidelity over determinism.

Know what that buys and costs. It is a genuine end-to-end path. It is also
non-deterministic in timing, costs free-tier quota, and fails when the model is
rate-limited (`test-plan.md` §7 already flags mass free-model calls as an
exposure).

This matters most for **R6** (AI progress feedback), the risk Phase 4 exists to
cover, because two things make "progress was visible" hard to assert honestly:

1. `StreamingText.tsx` renders the streaming cursor as
   `<span className="animate-pulse">▋</span>` — no `role`, no `aria-live`, no
   accessible name. No role locator can see it.
2. `ChatDemo.tsx` sets `isSubmitting = false` in a `finally` that runs when the
   response _headers_ arrive, so the button reverts from "Sending…" to "Ask"
   **while the stream is still streaming**.

So during the streaming window there is no accessible progress signal at all.
With real-model timing on top, an assertion that progress was visible is a race.
Prefer fixing the UI (`role="status" aria-live="polite"` on the streaming
region) over reaching for `getByTestId` — the missing role is a real
accessibility gap, not just a test inconvenience.

## Known UI issues these tests work around

- **Duplicate accessible name "Add car"** — the list trigger (`cars.addCar`) and
  the form submit (`cars.form.addCar`) are identical. It resolves today only
  because `CarList` hides the trigger while the form is open. Worth fixing.
