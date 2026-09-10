# Pre-demo Hardening Implementation Plan

## Overview

Close the five loose ends the 2026-09-07 app-state audit surfaced, before the
demo: gate CI on the tests that already exist, stop reflecting raw Supabase auth
messages into the sign-in page, give the streaming AI reply an accessible
progress signal, fix four config one-liners, and record a manual re-verification
pass for the thread-delete flow that F7 rewrote.

Nothing here is new product surface. Every item is a gap between what the project
already decided it wanted and what is actually wired.

## Current State Analysis

**CI is strictly weaker than the local pre-commit hook.** `.husky/pre-commit`
runs lint → lint:colors → typecheck → `npm test`; `.github/workflows/ci.yml:10-25`
runs lint → lint:colors → build. The bypassable local gate is the real one and
the unbypassable remote one is not. `context/foundation/test-plan.md:152` has
required unit + integration in CI since Phase 1 completed; neither runs.
`test-plan.md:151` additionally claims typecheck is "already wired — CI", which
is false.

**Auth errors round-trip attacker-controllable text through the query string.**
`src/pages/api/auth/signin.ts:16` and `signup.ts:16` redirect with
`?error=${encodeURIComponent(error.message)}`; `signin.astro:9` reads it and
`ServerError.tsx:11-14` renders it verbatim. Not XSS — React escapes it — but a
crafted link renders attacker-chosen prose inside the app's own styled alert on
the real origin, and the verbatim message distinguishes "Invalid login
credentials" from other conditions. Neither route logs. This is F8 from
`context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md:6-36`.

**The streaming reply is silent to a screen reader.**
`src/components/ai/StreamingText.tsx:31` renders a blinking `▋` with no role, no
accessible name, no live region. `context/foundation/prd.md:92` names the absence
of continuous visible progress a regression. It is also why the R6 Playwright
spec was never written (`e2e/README.md:72-86`).

**Config drift.** `.env` has `ClOUDFLARE_API_TOKEN` (lowercase L), so wrangler
silently ignores the token; `astro.config.mjs` runs `sitemap()` with no `site`,
so the integration no-ops with a build warning; `package.json:2` and
`src/layouts/Layout.astro:10` still carry the starter's name, the latter visible
in the browser tab.

**The delete flow has no coverage at the layer that was rewritten.** F7 replaced
N per-row islands with one delegated dialog
(`context/changes/ai-chat-history/reviews/impl-review.md:279-310`), closing with
_"Needs a browser re-check"_. The route and service layers are well covered
(`src/test/pages/api/ai/conversations.test.ts`,
`integration/isolation-conversations.test.ts`); the delegated-click → dialog →
redirect chain has none.

## Desired End State

A PR against `main` runs typecheck, unit + client tests, the integration suite
against a real local Supabase, and the Playwright suite — and `deploy` will not
run past a red fast gate or a red integration job. A crafted `?error=` link
renders nothing; a genuine auth failure renders a localized message from a closed
set and leaves a structured log line. A screen-reader user hears "Assistant is
replying…" when a reply starts and a terminal announcement when it ends, proven
by a deterministic Playwright spec that costs no OpenRouter quota. `npm run build`
emits no sitemap warning, and the browser tab says CarBooklet.

Verify by: opening a PR and seeing four green checks; loading
`/auth/signin?error=<script>whatever</script>` and seeing no alert box; running
the R6 spec; and walking the manual delete checklist in §Phase 7 once.

### Key Discoveries:

- **`ChatThread.tsx:87` is `{pending.active && <StreamingText … />}`** — the
  component is unmounted at the exact instant of the terminal transition, so a
  live region inside it can never announce "reply complete". The region must live
  in `ChatThreadContent`, mounted unconditionally.
- **`AuthError.code` is a real closed set** — `ErrorCode` in
  `@supabase/auth-js/dist/module/lib/error-codes.d.ts:6` is an 86-member union,
  and `AuthError` plus the `isAuthApiError` / `isAuthRetryableFetchError` guards
  **are** re-exported from `@supabase/supabase-js` (verified at runtime,
  contradicting the stale comment at `src/middleware.ts:21-25`).
- **`integration/globalSetup.ts:29-37` hard-refuses any non-localhost host**, and
  the existing `SUPABASE_URL` repository secret is the _cloud_ project
  (`context/deployment/deploy-plan.md:135`). The integration job cannot reuse it.
- **`src/pages/cars.astro:37,42` is the in-repo precedent** for an allowlisted
  closed-set `?error=` code resolved server-side through `getT`.
- **`src/components/hooks/useConversation.ts` has no abort state** — `stop()` and
  a normal `done` frame both reach `commitPending` and produce an identical
  `pending`. The only discriminator is `status` on the appended message (`:93`),
  and an abort before the first token appends nothing at all (`:92`).
- **No EN/PL key-parity gate exists anywhere.** The 191/191 figure in
  `change.md:32` was a manual audit.
- **`.tsx` files get zero a11y linting** — `eslint-plugin-astro` wraps the
  jsx-a11y rules and short-circuits on non-Astro files
  (`node_modules/eslint-plugin-astro/lib/index.js:4064`).

## What We're NOT Doing

- **Not adding `OPENROUTER_API_KEY` to `ci.yml` or the production Worker.**
  Closed by `change.md` OUT OF SCOPE item A. The R6 spec is stubbed precisely so
  this stays true.
- **Not changing the dashboard to show all cars** (item B), **not upgrading the
  Cloudflare plan** (item C), **not pinning the OpenRouter model** (item D).
- **Not investigating whether `npm run dev` publishes to the live Worker.** That
  is flagged for the user's own decision. Phase 3 sidesteps it for CI by not
  using `npm run dev`; it does not resolve it.
- **Not renaming `supabase/config.toml:5`'s `project_id`.** Local Docker stack
  only, and renaming disrupts existing volumes.
- **Not adding `.max()` bounds to `carSchema`** (F5 Fix B) — recorded in
  `change.md` as an untriaged follow-up.
- **Not dropping the `@astrojs/sitemap` integration.** Research favoured removal,
  but the scope decision was to set `site` instead.
- **Not touching `retries: 0`** in `playwright.config.ts:16-18` — a deliberate,
  documented decision.
- **Not writing E2E coverage for the thread-delete UI.** Item 5 is explicitly a
  manual note, not code.
- **Not localizing `src/components/auth/PasswordToggle.tsx:14`** or fixing the
  duplicate "Add car" accessible name (`e2e/README.md:90-93`).

## Implementation Approach

Seven phases in three groups. Phases 1-3 wire CI in increasing cost order, so the
cheap always-on gate lands first and every later phase is actually verified on
the PR. Phases 4-6 are the code changes, ordered so the two error-localization
items land together (F10's own write-up asks for this) before the a11y work.
Phase 7 is cleanup, docs, and the manual checklist.

The i18n key-parity test is deliberately in Phase 1 rather than Phase 7: phases 4
and 6 both add keys to both locale files, and a guard that lands afterwards
ratifies whatever shipped instead of catching it.

## Critical Implementation Details

**Live-region lifetime.** An `aria-live` region only announces mutations to a
node already in the accessibility tree. Any region that mounts and unmounts with
the thing it describes is announcing on a coin flip. This is why the region goes
in `ChatThreadContent` and stays mounted with empty text content, and why the
existing conditionally-mounted `role="status"` at `ChatThread.tsx:91-95` is a
precedent for _copy tone_, not for structure.

**react-compiler forbids the obvious implementation.** `eslint.config.js:63` runs
`react-compiler` at `error`, which rejects ref reads and writes during render.
Detect the `pending.active` edge in a `useEffect`, not a render-time comparison
against a `useRef` holding the previous value.

**`astro check` needs `astro sync` first.** `.astro/types.d.ts` must exist, so the
new `typecheck` step must be ordered after the existing `npx astro sync`
(`ci.yml:19`). Order the cheap gates ahead of it — `lint:colors` fails in ~50 ms,
per the lesson recorded at
`context/archive/2026-08-31-light-dark-mode/change.md:256-266`.

**Playwright strict mode will break on `getByRole("status")`.**
`ChatThread.tsx:92` is already a `role="status"`. The new region needs an
accessible name so both specs and screen readers can tell them apart.

---

## Phase 1: CI fast gate + i18n parity guard

### Overview

Add the two cheap checks CI is missing (~9 s combined, measured) and land the
locale parity test before any later phase adds keys.

### Changes Required:

#### 1. Fast checks in the `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Gate every push and PR on type correctness and the Docker-free test
suites, closing the compliance gap against `test-plan.md:151-152`.

**Contract**: Two new steps in the `ci` job, ordered
`npm ci` → `npx astro sync` → `npm run lint` → `npm run lint:colors` →
`npm run typecheck` → `npm test` → `npm run build`. `typecheck` must follow
`astro sync`; both new steps precede `build`. No new secrets, no new env.

#### 2. Locale key-parity test

**File**: `src/test/i18n/locale-parity.test.ts` (new)

**Intent**: Assert `en.json` and `pl.json` expose the same translation keys, so
the key additions in Phases 4-6 cannot silently land in one locale only.

**Contract**: Flatten both locale objects to dot-paths; strip i18next CLDR plural
suffixes (`_zero|_one|_two|_few|_many|_other`) to a base key before comparing, so
Polish's extra `_few`/`_many` forms are correct rather than a diff; assert the two
base-key sets are equal, and that no value is an empty string. Lives in the
`unit` project (`src/test/**/*.test.ts`, node env).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Colour lint passes: `npm run lint:colors`
- Type checking passes: `npm run typecheck`
- Unit + client tests pass, including the new parity test: `npm test`
- Build passes: `npm run build`
- The parity test fails when deliberately broken: add a key to `en.json` only, confirm red, revert

#### Manual Verification:

- A PR against `main` shows the `ci` check running typecheck and tests in its log
- Total `ci` job wall-clock has not grown materially (expect ~10 s added)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 2: CI integration job

### Overview

Run the 73-test integration suite against a real local Supabase in CI, and make
`deploy` depend on it.

### Changes Required:

#### 1. New `integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Execute `npm run test:integration` against a Docker Supabase stack
started inside the runner, satisfying `test-plan.md:152`.

**Contract**: A new job on `ubuntu-latest`, same triggers as `ci`, running
checkout → setup-node 22 with `cache: npm` → `npm ci` → start Supabase → export
env → `npm run test:integration`.

The Supabase CLI comes from devDependencies (`supabase`, resolved to 2.98.2 in
the lockfile), so `npx supabase` works after `npm ci` — no `supabase/setup-cli`
action needed. Start with the unused services excluded rather than editing
`supabase/config.toml`, so local dev keeps Studio and the rest:
`npx supabase start -x studio,realtime,storage-api,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor`.
Migrations apply automatically on start.

**Critical**: this job must **not** inherit the repository's `SUPABASE_URL`
secret, which points at the cloud project —
`integration/globalSetup.ts:29-37` will hard-refuse it. Derive all three required
variables from the running local stack via `npx supabase status -o env` and map
them into `$GITHUB_ENV` as the names the fixtures read
(`integration/fixtures/env.ts:33-43`): `SUPABASE_URL` ← the local API URL,
`SUPABASE_KEY` ← the anon key, `SUPABASE_SERVICE_ROLE_KEY` ← the secret key.
Verify the exact `-o env` output key names during implementation; newer CLIs emit
an `sb_secret_…` value rather than a `service_role` JWT (`e2e/README.md:16-20`).

#### 2. Deploy gating

**File**: `.github/workflows/ci.yml`

**Intent**: Stop a deploy from proceeding past a red integration suite.

**Contract**: `deploy.needs` becomes `[ci, integration]`. The `if:` condition and
the `wrangler-action` secrets block are unchanged.

### Success Criteria:

#### Automated Verification:

- The full suite passes locally against a running stack: `npm run test:integration`
- Linting passes: `npm run lint`
- The workflow file is valid — the `integration` job appears and runs on a PR
- The `integration` job is green on a PR, with all 73 tests reported
- The job log shows a `127.0.0.1`/`localhost` Supabase URL, not the cloud host

#### Manual Verification:

- `deploy` visibly waits on both `ci` and `integration` in the Actions graph
- Job wall-clock is acceptable (expect 2-4 min, dominated by Docker image pulls)
- Deliberately break one integration assertion on a scratch branch and confirm the PR check goes red

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: CI e2e job

### Overview

Run the Playwright suite in CI, and stop using `npm run dev` as the test server.

### Changes Required:

#### 1. Serve the built app instead of the dev server

**File**: `playwright.config.ts`

**Intent**: Replace the `webServer` command so E2E exercises a production build
and so CI never runs the dev server — the same command implicated in the
2026-09-07 `version_upload` to the live Worker that `change.md` flags for the
user's own verification.

**Contract**: `webServer.command` becomes `npm run build && npm run preview`;
raise `webServer.timeout` to accommodate a cold build (`120_000` → `180_000`).
`url`, `reuseExistingServer` and the `BASE_URL` default (port 4321) are
unchanged — `astro preview` serves the same port. **Do not** change
`retries: 0`. If CI artifacts are wanted later, `trace` would need to become
`retain-on-failure`, since `on-first-retry` never fires at zero retries; that is
out of scope here.

#### 2. New `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the three existing specs on every PR and push, without gating
deploy on a browser suite.

**Contract**: A new job mirroring `integration`'s setup and Supabase start, plus
`npx playwright install --with-deps chromium`, then `npm run test:e2e`. The same
locally-derived `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
must be in the environment for **both** the build the `webServer` performs and
the fixtures (`e2e/fixtures/env.ts:31-32` requires the URL and the service-role
key). `deploy.needs` stays `[ci, integration]` — this job is informational.
No `OPENROUTER_API_KEY`: no existing spec touches OpenRouter.

### Success Criteria:

#### Automated Verification:

- The suite passes locally against the preview server: `npm run test:e2e`
- `npm run preview` serves the built app on port 4321 with the local Supabase env
- Linting passes (the `e2eConfig` block covers `playwright.config.ts`): `npm run lint`
- Type checking passes — `astro check` is the only gate covering `e2e/`: `npm run typecheck`
- The `e2e` job is green on a PR, reporting 3 specs plus the setup project

#### Manual Verification:

- Confirm the job log shows `astro preview` (or its wrangler-backed equivalent) serving, and no `astro dev`
- Confirm no Cloudflare API activity is attributable to the run
- `deploy` does **not** wait on `e2e` in the Actions graph
- Deliberately break one spec on a scratch branch and confirm the check goes red while `deploy` still runs

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Auth error codes (F8)

### Overview

Replace the reflected Supabase message with a closed set of codes, resolved to
localized copy server-side, and log the real failure.

### Changes Required:

#### 1. The GoTrue error table

**File**: `src/lib/auth-errors.ts` (new)

**Intent**: Translate an unknown caught value from `signInWithPassword` /
`signUp` into one of a small closed set of codes, plus an `ErrorMapping` for the
log line. This is the GoTrue counterpart to `api-errors.ts`'s PostgREST table —
same rule, different subsystem.

**Contract**: Export a `readonly` tuple of codes and its derived union type; a
`mapAuthError(err: unknown): { code: AuthErrorCode; mapping: ErrorMapping }`; and
an `isAuthErrorCode(value: string | null): value is AuthErrorCode` type guard for
the page to allowlist the query parameter.

Key on `error.code` first — it is a genuine closed enum. Import `isAuthApiError`
and the other guards **directly from `@supabase/supabase-js`**, which re-exports
them. Client-authored errors carry `code: undefined` and must fall through to a
branch keyed on `error.name` / `error.status`: `AuthRetryableFetchError` (network
or 5xx) and `AuthInvalidCredentialsError` (thrown locally when a form field is
blank, status 400). Every unrecognised value falls to a generic code — the
`ErrorCode` union's own header warns the server may return codes outside the
list, so the default branch is load-bearing, not defensive padding.

The set must also carry a code for the `!supabase` branch that currently
redirects with the literal `"Supabase is not configured"`
(`signin.ts:11`, `signup.ts:11`).

Do not reflect, log, or include the submitted email anywhere. Route + code +
status is the credential-stuffing trace F8 asks for.

#### 2. The two routes

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Redirect with a code instead of a message, and leave a structured log
line where there is currently none.

**Contract**: On failure, `context.redirect('/auth/{signin,signup}?error=<code>')`.
Log via `logApiError(err, { route, method: "POST", surface: "ssr" }, mapping)`
with the explicit mapping from `mapAuthError` — **not** `apiErrorResponse` (these
routes redirect, they return no JSON) and **not** `logSsrError`, whose
`isServiceError(err) ? … : SERVER_ERROR` at `api-errors.ts:213` would log every
auth failure as a 500 with an empty code. Passing an explicit mapping to
`logApiError` is the established pattern — see `src/pages/api/ai/chat.ts:161-165`
and `src/lib/after-response.ts:31`. Route literals: `"/api/auth/signin"`,
`"/api/auth/signup"`. Success paths unchanged.

#### 3. The two pages

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Resolve an allowlisted code to localized copy, and render nothing at
all for a value that is not in the set — which is what closes the phishing
surface.

**Contract**: Read `Astro.url.searchParams.get("error")`, pass it through
`isAuthErrorCode`, and only then resolve it via the existing `getT(lang)` to the
matching `auth.errors.*` string; otherwise pass `null`. `SignInForm` /
`SignUpForm` keep their current `serverError?: string | null` prop and
`ServerError.tsx` is unchanged — it continues to receive an already-resolved
string. This mirrors `src/pages/cars.astro:37,42` exactly.

#### 4. Locale keys

**Files**: `src/i18n/locales/en.json`, `src/i18n/locales/pl.json`

**Intent**: One EN and one PL string per code.

**Contract**: A nested `errors` object under the existing `auth` namespace, keyed
by code, so the resolver is a direct `t(\`auth.errors.${code}\`)`. This is one
level deeper than the file's usual two-level shape — a deliberate deviation,
because the object maps 1:1 to the code tuple and the parity test flattens to
dot-paths regardless. Copy must not distinguish "wrong password" from "no such
user": the enumeration half of F8 is closed by the wording, not just the
mechanism.

#### 5. Tests

**File**: `src/test/lib/auth-errors.test.ts` (new)

**Intent**: Pin the table and prove the dynamic key lookup can never miss.

**Contract**: One case per mapped condition, covering both the `code`-keyed and
the `name`/`status`-keyed branches and the default; plus a case asserting every
member of the code tuple resolves to a non-empty string in **both** locale files
— this is what makes a dynamic `t()` key safe. Lives in the `unit` project, which
globs `.ts` only.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass, including the new mapper tests: `npm test`
- Locale parity test still passes with the new keys: `npm test`
- E2E sign-in still passes — the fixtures drive the real form: `npm run test:e2e`

#### Manual Verification:

- `/auth/signin?error=<script>alert(1)</script>` renders **no** alert box at all
- `/auth/signin?error=Your+account+is+locked,+call+555-0100` renders nothing
- A genuine wrong-password sign-in renders localized copy; the same copy appears for a non-existent email
- Switching to Polish (`lang` cookie) renders the Polish string
- The failure emits one structured `api_error` log line with `surface: "ssr"`, the route, the code, and **no email**

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: API error localization (F10)

### Overview

Stop rendering the five English server literals; resolve copy from the HTTP
status client-side instead. Sequenced immediately after Phase 4 so the app ends
up with one story about who translates what.

### Changes Required:

#### 1. Status → i18n key helper

**File**: `src/lib/http-error-copy.ts` (new)

**Intent**: Map an HTTP status to a translation key, so consumers stop reading
`json.error`.

**Contract**: A single exported function taking a status and returning an i18n
key, covering the five statuses `mapErrorCode` can produce (400, 401, 404, 500, 503) with a generic fallback for anything else. Mirrors the shape of
`errorForResponse` in `src/components/hooks/useConversation.ts:222-226`, but keyed
on status alone — **not** on the response's message text, which is the one wart
in that function not to copy.

#### 2. Locale keys

**Files**: `src/i18n/locales/en.json`, `src/i18n/locales/pl.json`

**Intent**: Localized equivalents of the five literals.

**Contract**: Five new keys in the existing `common` namespace, alongside
`networkError`, `anErrorOccurred` and `loadFailed`.

#### 3. The fourteen consumers

**Files**: `src/components/cars/CarForm.tsx:89`;
`src/components/cars/CarList.tsx:57,67,105`;
`src/components/entries/RepairEntryForm.tsx:60`;
`src/components/entries/RepairEntryEditForm.tsx:58`;
`src/components/entries/OilChangeEntryForm.tsx:49`;
`src/components/entries/OilChangeEntryEditForm.tsx:56`;
`src/components/entries/InspectionEntryForm.tsx:58`;
`src/components/entries/InspectionEntryEditForm.tsx:66`;
`src/components/entries/InsuranceEntryForm.tsx:69`;
`src/components/entries/InsuranceEntryEditForm.tsx:68`;
`src/components/entries/EntryDetailEditor.tsx:64`;
`src/components/ai/DeleteConversationDialog.tsx:84`

**Intent**: Replace `json.error ?? t("common.anErrorOccurred")` with copy
resolved from `res.status`, retiring a fallback that is currently dead because
`error` is always present.

**Contract**: Each site is inside an `if (!res.ok)` and already has `res.status`
in scope. Where the response body becomes entirely unused, drop the now-dead
`await res.json()`; check each site first — some read other fields.
`CarList.tsx:57` throws rather than setting state, so it takes the resolved
string as the `Error` message. Leave
`src/components/hooks/useConversation.ts:150` alone — it is already status-keyed
through `ChatError`.

**Do not** change the five literals in `src/lib/api-errors.ts:30-34`. Translating
them server-side would break roughly fifteen assertions —
`src/test/lib/api-errors.test.ts:44-57`, `:66`, and the `ALLOWED` closed-set
assertion at `:85-96` — plus the eight envelope `toEqual` cases in
`src/test/pages/api/ai/chat.test.ts`. The whole point of the client-side route is
that no server code and no existing assertion changes.

#### 4. Tests

**File**: `src/test/lib/http-error-copy.test.ts` (new)

**Contract**: One case per mapped status plus the fallback, and a case asserting
every returned key resolves in both locales.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit + client tests pass, with `api-errors.test.ts` and `chat.test.ts` untouched and green: `npm test`
- Locale parity test passes with the five new keys: `npm test`
- No consumer still reads `json.error` for these cases: `grep -rn "json.error ?? t(" src/components/` returns nothing

#### Manual Verification:

- Trigger a validation failure in a car form and an entry form; confirm localized copy
- Switch to Polish and confirm the same paths render Polish, matching the auth copy from Phase 4
- Confirm the AI chat's own error line (`ChatThread.tsx:145-156`) is unchanged

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Streaming a11y + R6 spec

### Overview

Give the in-flight reply an accessible progress signal that survives the
transition it reports on, and guard it with a deterministic Playwright spec.

### Changes Required:

#### 1. The live region

**File**: `src/components/ai/ChatThread.tsx`

**Intent**: Announce stream state _transitions_ — and only transitions — to a
screen reader, from a region that outlives the stream.

**Contract**: A visually-hidden (`sr-only`) element inside `ChatThreadContent`,
rendered **unconditionally**, carrying `role="status"`, `aria-live="polite"` and
an accessible name from a new i18n key. It is a sibling of the `ScrollArea`,
never an ancestor of the markdown. It holds a short announcement string, empty
when idle.

Derive the announcement in a `useEffect` keyed on `pending.active` —
`react-compiler` runs at `error` and rejects a render-time ref comparison. The
transition table:

| Edge                                               | Announce                      |
| -------------------------------------------------- | ----------------------------- |
| `active` false → true                              | "Assistant is replying…"      |
| true → false, last message `status === "complete"` | "Reply complete"              |
| true → false, last message `status === "aborted"`  | existing `aiChat.interrupted` |
| true → false, last message `status === "error"`    | existing `aiChat.failed`      |
| true → false, transcript did not grow              | existing `aiChat.interrupted` |

That last row is the abort-before-first-token case: `commitPending` returns early
on an empty buffer (`useConversation.ts:92`) and appends nothing, so a
`messages.length`-keyed announcer would go silent. Note also that an `{"error"}`
SSE frame sets `error` without ending the stream (`:168-171`) — "error appeared"
and "reply ended" are independent transitions, and only the latter belongs here.
The existing error line at `ChatThread.tsx:91-95` keeps announcing the former.

**Do not** put `aria-live` on the `space-y-6` wrapper at `ChatThread.tsx:82` or
the `ScrollArea` viewport — both contain the markdown, which re-parses on every
token delta, and either would produce hundreds of interruptions per reply.

#### 2. Busy state on the streaming text

**File**: `src/components/ai/StreamingText.tsx`

**Intent**: Mark the region as in-flight without making it chatty.

**Contract**: `aria-busy={active}` on the text container (`:29`); the decorative
caret at `:31` gets `aria-hidden`. No live region here — the component unmounts
at the transition. Note `active` is always literal `true` in production
(`ChatThread.tsx:87`); keep the prop honest rather than removing it.

#### 3. Locale keys

**Files**: `src/i18n/locales/en.json`, `src/i18n/locales/pl.json`

**Contract**: Three keys in the `aiChat` namespace — the "replying" and "reply
complete" announcements plus the region's accessible name — slotted after
`"stop"` (line 184 in both files, which are line-for-line aligned), keeping the
composer cluster together. `aiChat.interrupted` and `aiChat.failed` already exist
and are reused. Note `aiChat.sending` is now dead; leaving it is fine.

#### 4. First component test

**File**: `src/test/client/ChatThread.test.tsx` (new)

**Intent**: Prove the announcements fire on both edges — nothing currently
renders `ChatThread` or `StreamingText`.

**Contract**: Must live under `src/test/client/` — the `unit` project excludes
`.tsx` by design (`vitest.config.ts:47-48`). Reuse the `controllableBody()`
harness and SSE fixture from `src/test/client/useConversation.test.tsx:40-80` to
hold a stream open, assert the "replying" announcement, then close it and assert
the terminal announcement. Cover the abort-before-first-token case explicitly.
Rendering `ChatThread` pulls in `I18nextProvider`, both locale files and
`react-markdown` under jsdom — heavier than any existing client test; if that
proves unwieldy, assert against the region in isolation with a bare
`I18nextProvider` wrapper.

#### 5. The R6 spec

**File**: `e2e/ai-progress.spec.ts` (new)

**Intent**: Cover risk R6 (`test-plan.md:54,87`) — that the user sees continuous
progress from submit through to streamed response — deterministically.

**Contract**: Intercept `**/api/ai/chat` with `page.route` and fulfil a canned
SSE body built from the frame contract at `src/lib/chat.ts:24-31`
(`{meta}` → `{text}` → `{done}` → `[DONE]`). Locate the new region by role **and
accessible name** — a bare `getByRole("status")` collides with
`ChatThread.tsx:92` and dies in strict mode. Assert: the replying announcement
appears, the composer button reads "Stop" mid-stream, and the terminal
announcement appears. Assert the _presence of progress_, never the answer's
content, and never `page.waitForTimeout` — both are named anti-patterns in
`test-plan.md:87`. English copy: the fixture pins `lang=en`
(`e2e/fixtures/app.ts:169-172`). Wait for hydration via the
`astro-island[ssr]` count as the other specs do (`app.ts:199`).

#### 6. Record the stubbing exception

**File**: `e2e/README.md`

**Intent**: `:62-66` currently states in writing that E2E hits the real model with
nothing mocked. This spec is a deliberate exception and the doc must say so.

**Contract**: Amend the "AI / OpenRouter boundary" section — the real-model
default stands for flows that exercise the server chat route; R6 is stubbed
because its claim is about the UI's loading-state transitions, not the model's
answer, and because a stub can drive a slow-first-token case a live model cannot
be made to produce. Update the `:72-84` passage, which currently records the
missing role as the reason R6 was never written.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Colour lint passes: `npm run lint:colors`
- Type checking passes: `npm run typecheck`
- Unit + client tests pass, including the new component test: `npm test`
- The new spec passes: `npm run test:e2e`
- The spec makes no OpenRouter request — confirm by running with no `OPENROUTER_API_KEY` set
- The component test fails when the effect is deliberately removed, then passes when restored

#### Manual Verification:

- With VoiceOver (or NVDA), start a reply: hear "Assistant is replying…" once, **not** per token
- Hear the terminal announcement when the reply ends
- Press Stop mid-reply and hear the interrupted announcement
- Confirm the markdown itself is never read aloud token-by-token
- Confirm the caret is not announced

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 7: Config hygiene, docs, and the manual checklist

### Overview

Four one-liners, three factual corrections to the project's own test plan, and
the browser re-check F7 asked for.

### Changes Required:

#### 1. Cloudflare token typo

**Files**: `.env` (local, gitignored), `.env.example`

**Intent**: `.env:3` reads `ClOUDFLARE_API_TOKEN` — lowercase L — so wrangler
never sees the token and falls back to interactive OAuth.

**Contract**: Rename the key to `CLOUDFLARE_API_TOKEN` in the developer's local
`.env`. This file is gitignored (`.gitignore:18`), so the typo was never
committed and nothing in the repo reads it — blast radius is one machine. Add
`CLOUDFLARE_API_TOKEN` to the tracked `.env.example`, which does not currently
mention it in any spelling. Never print or commit the value.

#### 2. Sitemap `site`

**File**: `astro.config.mjs`

**Intent**: `sitemap()` runs with no `site`, so it no-ops with a build warning.

**Contract**: Add `site: "https://car-booklet.carbooklet.workers.dev"` — the URL
recorded as authoritative at `context/deployment/deploy-plan.md:9`. Keep the
integration. Nothing else in the codebase reads `Astro.site`.

#### 3. Project name

**Files**: `package.json`, `package-lock.json`

**Intent**: `package.json:2` is still `10x-astro-starter`.

**Contract**: Rename to `car-booklet`, matching `wrangler.jsonc:3` (which
hardcodes its own name and does **not** derive from this, so the deployed Worker
is unaffected). Re-sync the two lockfile occurrences (lines 2 and 8) by running
`npm install`; no integrity hash involves the name. Leave `README.md:26-27` and
`src/lib/config-status.ts:16` — both are upstream URLs and correct as-is.

#### 4. Default page title

**File**: `src/layouts/Layout.astro`

**Intent**: `:10` defaults `title` to `"10x Astro Starter"`, which shows in the
browser tab on any page that omits the prop — the one cosmetic item a demo
audience can see.

**Contract**: Change the default to the product name. Check which pages rely on
the default rather than passing `title`.

#### 5. Test-plan corrections

**File**: `context/foundation/test-plan.md`

**Intent**: Phases 1-3 make one stale claim true and leave two others wrong.

**Contract**: Correct `:151` (claims typecheck is "already wired — husky/lint-staged

- CI"; before this change it was pre-commit only, after it is genuinely both);
  correct `:128` and `:97-100`, which state e2e is "none yet" though Playwright and
  three specs exist — already flagged at
  `context/archive/2026-08-31-light-dark-mode/research.md:449`. Mark Phase 4's CI-gate
  half as landed. Factual corrections only — do not rewrite the frozen §1-§5
  content beyond them.

#### 6. Manual delete-flow checklist

**Intent**: F7 rewrote the delete flow from N per-row islands to one delegated
dialog and closed with _"Needs a browser re-check"_. The last sign-off (plan item
4.10) predates it, and no automated test reaches that layer. This is a
verification pass, **not** a code change — the flow is believed working.

**Contract**: The Manual rows in this phase's Progress section are the checklist.
Preconditions: local Supabase up, `npm run dev`, signed in, a car selected, and
**three** threads created on it (`/ai-chat?new=1` → send a message → repeat) so
all three cases are reachable.

Two things to know before walking it. **Esc may not close the dialog** —
`DeleteConversationDialog.tsx:99` controls `AlertDialog` by `open` with no
`onOpenChange`, so only `AlertDialogCancel` (`:110`) has a wired path back to
state; if it stays open, that is a real (small) finding to record, not tester
error. And the dialog mounts `client:idle` — before hydration the trash button is
inert, so let the page settle rather than clicking on a cold load and reporting a
dead button.

### Success Criteria:

#### Automated Verification:

- Build emits no `@astrojs/sitemap` warning: `npm run build`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit + client tests pass: `npm test`
- `npm ci` still succeeds against the renamed lockfile
- `grep -rn "10x-astro-starter" package.json package-lock.json src/layouts/` returns nothing
- `wrangler secret list` works without re-exporting the token by hand

#### Manual Verification:

- Browser tab shows the product name on a page that omits `title`
- Delete a **non-active** thread: URL does not change on the trash click, dialog opens, and it **names the thread you clicked** (the capability F7 added — the highest-value assertion here)
- Press Esc on the open dialog and record whether it closes
- Click Cancel: dialog closes, list unchanged
- Click a different row's trash icon: the dialog shows _that_ row's title, proving the target is re-read per click
- Confirm a delete: button shows the deleting label, full page load to `/ai-chat`, redirect to the most recent remaining thread, row gone
- Delete the **currently-open** thread: lands on the one remaining thread, not a 404 and not the dead URL
- Delete the **last remaining** thread: lands on `/ai-chat` itself with the empty state, "New chat" present, and no trash icons or dialog — correct, not a bug
- Hard-refresh: deleted threads stay gone
- `fetch('/api/ai/conversations/00000000-0000-0000-0000-000000000000', {method:'DELETE'})` in DevTools returns `404 {"error":"Not found"}`

**Implementation Note**: This is the final phase. After it, the change is ready
for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- Locale key parity across EN/PL, tolerant of CLDR plural suffixes (Phase 1)
- The GoTrue error table: `code`-keyed branches, `name`/`status`-keyed branches, the default, and full locale coverage of the code tuple (Phase 4)
- The status → i18n key helper and its fallback (Phase 5)

### Client Tests:

- `ChatThread`'s live region on both transition edges, including abort-before-first-token (Phase 6) — the repo's first component render test

### Integration Tests:

- No new integration tests. Phase 2 wires the existing 73 into CI unchanged.

### E2E Tests:

- The three existing specs, now running in CI against a production build (Phase 3)
- One new stubbed spec covering R6's progress transitions (Phase 6)

### Manual Testing Steps:

1. Craft `/auth/signin?error=<arbitrary text>` and confirm nothing renders (Phase 4)
2. Drive a real auth failure in both locales and confirm localized, non-enumerating copy (Phase 4)
3. Listen to a full AI reply with a screen reader, including a Stop mid-reply (Phase 6)
4. Walk the eleven delete-flow steps in Phase 7

## Performance Considerations

The fast gate adds ~10 s to every push (measured: `npm test` 1.6 s,
`npm run typecheck` 7.6 s). The integration and e2e jobs are minutes, dominated
by Docker image pulls and the browser download, which is why they are separate
jobs rather than steps in `ci` — a slow browser run must not block the cheap
gate, and `deploy` waits only on `ci` and `integration`.

The live region announces state transitions only. Putting `aria-live` on the
markdown container instead would fire on every token delta — hundreds of screen
reader interruptions per reply — which is the specific failure this design avoids.

## Migration Notes

No data migration, no schema change, no new Supabase migration file. The only
irreversible-ish step is the `package.json` rename touching `package-lock.json`;
`npm install` regenerates both lines and no integrity hash involves the project
name.

## References

- Change brief: `context/changes/pre-demo-fixes/change.md`
- Research: `context/changes/pre-demo-fixes/research.md`
- F8 and F10 originals: `context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md:6-36`, `:75-106`
- F7 and the browser re-check it asked for: `context/changes/ai-chat-history/reviews/impl-review.md:279-310`
- Risk register and quality gates: `context/foundation/test-plan.md:54`, `:87`, `:100`, `:143-156`
- Closed-set error precedents: `src/pages/cars.astro:37,42` (SSR), `src/components/ai/ChatThread.tsx:145-156` (client)
- CI edit precedent: `context/archive/2026-08-31-light-dark-mode/plan.md:772-789`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI fast gate + i18n parity guard

#### Automated

- [x] 1.1 Linting passes — 376c6dd
- [x] 1.2 Colour lint passes — 376c6dd
- [x] 1.3 Type checking passes — 376c6dd
- [x] 1.4 Unit + client tests pass, including the new parity test — 376c6dd
- [x] 1.5 Build passes — 376c6dd
- [x] 1.6 Parity test fails when deliberately broken, then passes when reverted — 376c6dd

#### Manual

- [x] 1.7 PR shows the `ci` check running typecheck and tests in its log — 376c6dd
- [x] 1.8 `ci` job wall-clock has not grown materially — 376c6dd

### Phase 2: CI integration job

#### Automated

- [x] 2.1 Integration suite passes locally against a running stack
- [x] 2.2 Linting passes
- [x] 2.3 The `integration` job appears and runs on a PR
- [x] 2.4 The `integration` job is green on a PR with all 73 tests reported
- [x] 2.5 Job log shows a localhost Supabase URL, not the cloud host

#### Manual

- [x] 2.6 `deploy` waits on both `ci` and `integration` in the Actions graph
- [x] 2.7 Job wall-clock is acceptable
- [ ] 2.8 A deliberately broken integration assertion turns the PR check red

### Phase 3: CI e2e job

#### Automated

- [ ] 3.1 E2E suite passes locally against the preview server
- [ ] 3.2 `npm run preview` serves the built app on port 4321 with the local Supabase env
- [ ] 3.3 Linting passes
- [ ] 3.4 Type checking passes
- [ ] 3.5 The `e2e` job is green on a PR, reporting 3 specs plus setup

#### Manual

- [ ] 3.6 Job log shows the preview server, not `astro dev`
- [ ] 3.7 No Cloudflare API activity attributable to the run
- [ ] 3.8 `deploy` does not wait on `e2e`
- [ ] 3.9 A deliberately broken spec turns the check red while `deploy` still runs

### Phase 4: Auth error codes (F8)

#### Automated

- [ ] 4.1 Linting passes
- [ ] 4.2 Type checking passes
- [ ] 4.3 Unit tests pass, including the new mapper tests
- [ ] 4.4 Locale parity test passes with the new keys
- [ ] 4.5 E2E sign-in still passes

#### Manual

- [ ] 4.6 `?error=<script>alert(1)</script>` renders no alert box
- [ ] 4.7 A crafted phishing-style `?error=` value renders nothing
- [ ] 4.8 Wrong password and non-existent email render identical localized copy
- [ ] 4.9 Polish locale renders the Polish string
- [ ] 4.10 One structured `api_error` log line with `surface: "ssr"`, route, code, and no email

### Phase 5: API error localization (F10)

#### Automated

- [ ] 5.1 Linting passes
- [ ] 5.2 Type checking passes
- [ ] 5.3 Unit + client tests pass with `api-errors.test.ts` and `chat.test.ts` untouched
- [ ] 5.4 Locale parity test passes with the five new keys
- [ ] 5.5 No consumer still reads `json.error` for these cases

#### Manual

- [ ] 5.6 Car form and entry form failures render localized copy
- [ ] 5.7 Polish renders Polish, matching Phase 4's auth copy
- [ ] 5.8 The AI chat error line is unchanged

### Phase 6: Streaming a11y + R6 spec

#### Automated

- [ ] 6.1 Linting passes
- [ ] 6.2 Colour lint passes
- [ ] 6.3 Type checking passes
- [ ] 6.4 Unit + client tests pass, including the new component test
- [ ] 6.5 The new R6 spec passes
- [ ] 6.6 The spec makes no OpenRouter request with no `OPENROUTER_API_KEY` set
- [ ] 6.7 The component test fails when the effect is removed, then passes when restored

#### Manual

- [ ] 6.8 Screen reader announces "Assistant is replying…" once, not per token
- [ ] 6.9 Screen reader announces the terminal state when the reply ends
- [ ] 6.10 Stop mid-reply announces the interrupted state
- [ ] 6.11 The markdown is never read aloud token-by-token
- [ ] 6.12 The caret is not announced

### Phase 7: Config hygiene, docs, and the manual checklist

#### Automated

- [ ] 7.1 Build emits no `@astrojs/sitemap` warning
- [ ] 7.2 Linting passes
- [ ] 7.3 Type checking passes
- [ ] 7.4 Unit + client tests pass
- [ ] 7.5 `npm ci` succeeds against the renamed lockfile
- [ ] 7.6 No `10x-astro-starter` remains in package.json, package-lock.json, or src/layouts/
- [ ] 7.7 `wrangler secret list` works without re-exporting the token by hand

#### Manual

- [ ] 7.8 Browser tab shows the product name on a page that omits `title`
- [ ] 7.9 Non-active thread delete: URL unchanged on click, dialog opens naming the clicked thread
- [ ] 7.10 Esc behaviour on the open dialog recorded
- [ ] 7.11 Cancel closes the dialog, list unchanged
- [ ] 7.12 A different row's trash icon shows that row's title
- [ ] 7.13 Confirmed delete: deleting label, full reload, redirect to most recent remaining thread, row gone
- [ ] 7.14 Deleting the currently-open thread lands on the remaining thread, not a 404
- [ ] 7.15 Deleting the last thread lands on `/ai-chat` with the empty state and no dialog
- [ ] 7.16 Hard-refresh: deleted threads stay gone
- [ ] 7.17 DELETE on a nonexistent uuid returns `404 {"error":"Not found"}`
