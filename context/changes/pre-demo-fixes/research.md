---
date: 2026-09-10T15:39:09+02:00
researcher: Aleksander
git_commit: 3e3e6f590c77276cd4c631db8d5eeb0fe918ae69
branch: main
repository: CarBooklet
topic: "Pre-demo hardening — CI test gate, auth error reflection, streaming a11y, config hygiene"
tags:
  [
    research,
    codebase,
    ci,
    github-actions,
    vitest,
    playwright,
    supabase-auth,
    i18n,
    accessibility,
    aria-live,
    error-handling,
    config,
  ]
status: complete
last_updated: 2026-09-10
last_updated_by: Aleksander
---

# Research: Pre-demo hardening — CI test gate, auth error reflection, streaming a11y, config hygiene

**Date**: 2026-09-10 15:39 +02:00
**Researcher**: Aleksander
**Git Commit**: `3e3e6f590c77276cd4c631db8d5eeb0fe918ae69`
**Branch**: `main`
**Repository**: CarBooklet (`github.com/sAleksander/CarBooklet`, public)

## Research Question

Ground the five IN SCOPE items of `change.md` in the live codebase so `/10x-plan`
can plan them without re-deriving mechanics: (1) CI runs no tests, (2) auth error
reflection, (3) streaming reply has no accessible progress signal, (4) config
hygiene, (5) thread-delete manual re-verification.

The OUT OF SCOPE table in `change.md` was treated as closed. Nothing below
re-opens items A–D.

## Summary

Every IN SCOPE item is real, still present at `3e3e6f5`, and sized roughly as
`change.md` estimated. Research did not overturn any triage decision. It did
surface **five things that change what the planner should write**, plus a batch
of smaller corrections.

**The five that matter:**

1. **Item 3's prescribed fix shape is wrong as written, and would not work.**
   `change.md` says to put a visually-hidden live region in `StreamingText.tsx`.
   But `ChatThread.tsx:87` renders `{pending.active && <StreamingText … />}` —
   the component is _unmounted at the exact instant_ the "reply complete"
   transition happens. A live region inside it can never announce the end state,
   because `aria-live` only reports mutations to a region already in the
   accessibility tree. **The region must be hoisted into `ChatThreadContent`,
   rendered unconditionally.** `aria-busy` can stay on `StreamingText`'s text
   container. Everything else about the item's design guidance holds.

2. **Item 2's mapper has a better key than `change.md` assumed.**
   `AuthError.code` is a genuine closed set — `ErrorCode` in
   `@supabase/auth-js` is an 86-member union — and both `AuthError` and the
   `isAuthApiError`/`isAuthRetryableFetchError` guards **are** re-exported from
   `@supabase/supabase-js` (verified at runtime). So the mapper keys on
   `error.code`, not on message text. Caveat: client-authored errors carry
   `code: undefined` and need an `error.name`/`error.status` fallback branch.

3. **Item 1 has a blocker not named in `change.md`: the existing `SUPABASE_URL`
   repository secret points at the _cloud_ project.** `integration/globalSetup.ts:29-37`
   hard-refuses any non-localhost host. An integration job cannot reuse the
   existing secrets — it needs its own local env block.

4. **Item 1's e2e stage collides with item 5's flagged prod-upload concern.**
   `playwright.config.ts:47` runs `npm run dev` as its `webServer` — the same
   command implicated in the 2026-09-07 `version_upload` to the live Worker.
   Switching `webServer.command` to `npm run build && npm run preview` sidesteps
   the question entirely and is faster in CI besides.

5. **Item 1's e2e stage does _not_ collide with OUT OF SCOPE item A.** No
   existing spec touches OpenRouter — `grep -rn -i openrouter e2e/` matches only
   prose. E2E can run in CI today without the forbidden `OPENROUTER_API_KEY`.
   The collision only appears _if_ the planner also writes the R6 spec against
   the real model.

**Smaller corrections to `change.md`'s text:**

- `change.md:29` says `astro check` covers 248 files; the measured figure at this
  commit is **141 files, 0 errors, 7.6 s**. `npm test` measures **419/419 pass in
  1.6 s**. Both are cheap enough to be unconditional CI steps.
- `change.md:32`'s "191/191 i18n parity" was a manual audit. **No parity test or
  script exists anywhere.** Items 2 and 3 both add keys to both locale files with
  no gate to catch a miss.
- `change.md:52` says the integration suite is "6 files". It is 6 spec files
  (73 tests) plus 4 fixture/setup files.
- `change.md:146` asks to "check that `.env.example` spells it correctly".
  `.env.example` does not contain `CLOUDFLARE_API_TOKEN` **at all**, correctly
  spelled or otherwise. The item resolves to a local-only fix plus an optional
  documentation add.
- F10's write-up lists 13 consumer sites; there are now **14** —
  `DeleteConversationDialog.tsx:84` post-dates the follow-up.

**Two adjacent one-liners surfaced that item 4 does not list**, both in the same
cosmetic family, and one of them is visible during the demo:
`src/layouts/Layout.astro:10` still defaults the page title to `"10x Astro
Starter"` (browser tab, on any page that omits `title`), and
`supabase/config.toml:5` still has `project_id = "10x-astro-starter"` (local
Docker stack only — renaming disrupts existing volumes, so probably decline).

## Detailed Findings

### Item 1 — CI runs no tests

#### What exists

`.github/` contains exactly one file: `.github/workflows/ci.yml` (54 lines, two
jobs). No dependabot config, no templates, no composite actions, no CODEOWNERS.

- `ci` job (`ci.yml:10-25`): checkout → setup-node 22 (`cache: npm`) → `npm ci`
  → `npx astro sync` → `npm run lint` → `npm run lint:colors` → `npm run build`.
- `deploy` job (`ci.yml:27-54`): **`needs: ci`** (`ci.yml:29`), gated on
  `push` to `main` (`ci.yml:30`), re-builds and ships via
  `cloudflare/wrangler-action@v3`.

The local `.husky/pre-commit` hook already runs the full gate stack —
`lint-staged` → `lint` → `lint:colors` → `typecheck` → `npm test` — so CI is
strictly weaker than pre-commit, and pre-commit is bypassable with `--no-verify`
and never runs on a PR.

#### The three suites, precisely

**`npm test` (unit + client) — zero prerequisites, confirmed.**
`vitest.config.ts` declares three projects in one file (no workspace file):

| Project                                  | Glob                                                   | Env   | Aliases                              |
| ---------------------------------------- | ------------------------------------------------------ | ----- | ------------------------------------ |
| `unit` (`vitest.config.ts:32-52`)        | `src/test/**/*.test.ts`, excludes `src/test/client/**` | node  | `@`→`./src`, `astro:env/server`→mock |
| `client` (`vitest.config.ts:53-65`)      | `src/test/client/**/*.test.{ts,tsx}`                   | jsdom | same two                             |
| `integration` (`vitest.config.ts:66-87`) | `integration/**/*.test.ts`                             | node  | `@` only                             |

The `astro:env/server` alias is declared **per-project**, twice
(`vitest.config.ts:41` and `:57`), deliberately omitted from `integration`
(`vitest.config.ts:38-40`). The mock at
`src/test/__mocks__/astro-env-server.ts:6-8` gives all three env fields a
non-empty placeholder fallback, which is why `new OpenAI({ apiKey })` at
`src/lib/services/ai.ts:7-13` constructs at module-eval time with no real key.
`vitest.config.ts` never calls `process.loadEnvFile()` — only
`integration/fixtures/env.ts:15`, `e2e/fixtures/env.ts:13` and
`playwright.config.ts:4` do. There are no `setupFiles` anywhere.

**`npm run test:integration` — Docker, local-only, service-role.**
6 spec files / 73 tests + 4 fixtures. Hard-requires three env vars, read through
a throwing `required()` at `integration/fixtures/env.ts:20-43`: `SUPABASE_URL`,
`SUPABASE_KEY` (re-exported as `SUPABASE_ANON_KEY` at `:41`), and
`SUPABASE_SERVICE_ROLE_KEY`.

The localhost guard — the blocker named in the Summary —
`integration/globalSetup.ts:16,29-37`:

```ts
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);
…
if (!LOCAL_HOSTS.has(url.hostname)) {
  throw new Error(`Refusing to run integration tests against a non-local Supabase.…`);
}
```

A second guard (`globalSetup.ts:42-68`) probes `${SUPABASE_URL}/rest/v1/` with a
5 s `AbortSignal.timeout` and fails fast on a down stack or a stale anon key.

Users are created and deleted through the admin client —
`integration/fixtures/users.ts:84-88` (`admin.auth.admin.createUser`,
`email_confirm: true`), `:143`, `:174` — with cleanup by `ON DELETE CASCADE`.
Migrations are required: `integration/validation-constraints.test.ts:26-30`
asserts against DB constraints by migration name as an independent oracle.
`npx supabase start` applies them automatically. **No seed file exists** —
`supabase/config.toml:60-65` points `[db.seed]` at `./seed.sql`, which is not in
the repo; rows are seeded per-test via the owner's own RLS-subject client
(`integration/fixtures/seed.ts:1-14`). No external API is touched:
`grep -rn "openrouter|OPENROUTER|openai|astro:env" integration/` → no matches.

Run cost: 10 sign-ins per full run, against a `sign_in_sign_ups = 30` per-5-min
per-IP cap (`supabase/config.toml:190`) — comfortable, and the reason
`vitest.config.ts:83-86` pins `pool: "forks"` + `singleFork: true`.

**`npm run test:e2e` — Playwright, chromium only.**
`playwright.config.ts` in full: `BASE_URL = process.env.E2E_BASE_URL ??
"http://localhost:4321"` (`:9`); `testDir: "./e2e"`, `fullyParallel: true`
(`:12-13`) with **no `workers` cap**; `forbidOnly: !!process.env.CI` (`:14`);
**`retries: 0`, deliberately including on CI** (`:16-18` — _"A retry turns a
flaky test green and hides the flake"_); `reporter: CI ? "github" : "list"`
(`:20`); `trace: "on-first-retry"`, `screenshot: "only-on-failure"` (`:22-26`);
two projects — `setup` (`/auth\.setup\.ts/`) and `chromium` with
`storageState: "playwright/.auth/user.json"` and `dependencies: ["setup"]`
(`:37-44`); `webServer` = `npm run dev` at `BASE_URL`,
`reuseExistingServer: !process.env.CI`, `timeout: 120_000` (`:46-51`).

Three specs — `e2e/seed.spec.ts` (R5 exemplar), `e2e/cross-user-data-isolation.spec.ts`
(R3), `e2e/car-delete-blast-radius.spec.ts` (R5) — plus `e2e/auth.setup.ts`.
All use the `signedInPage` fixture, which opts **out** of the shared storageState
(`e2e/fixtures/app.ts:64`) and seeds a throwaway user per test via the admin
client (`app.ts:82-89`), deleting it after (`app.ts:94-95`).
`e2e/fixtures/env.ts:31-32` requires `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` but **not** `SUPABASE_KEY`, and — unlike integration
— **there is no localhost guard on the e2e path at all**.

`trace: "on-first-retry"` is effectively dead code given `retries: 0`; if the
planner wants CI failure artifacts, that must become `retain-on-failure`. Do not
"fix" `retries: 0` — it is a written decision.

#### Measured timings (this machine, this commit)

| Command             | Wall clock                         | Result                                   |
| ------------------- | ---------------------------------- | ---------------------------------------- |
| `npm test`          | **1.57 s** (vitest reports 1.13 s) | 419/419 pass, 15 files                   |
| `npm run typecheck` | **7.60 s**                         | 0 errors, 0 warnings, 5 hints, 141 files |

The 5 hints are `ts(6387)` deprecation notices on `tseslint.config` in
`eslint.config.js` — pre-existing, not blocking. `astro check` needs
`.astro/types.d.ts`, which the existing `npx astro sync` step (`ci.yml:19`)
already produces, so `typecheck` must be ordered after it. `tsconfig.json:3`
includes `**/*`, which makes `astro check` **the only gate that type-checks
`integration/` and `e2e/`** — recorded previously at
`context/archive/2026-08-24-swallowed-error-propagation/plan.md:174-179`.

#### Local Supabase footprint (for a CI service)

`supabase/config.toml` — 9 migrations, Postgres 17 (`:36`). Required:
`[api]` on 54321 (`:8-10`), `[db]` on 54322 (`:29-33`), `[db.migrations]`
(`:55`), `[auth]` (`:151`, `enable_confirmations = false` at `:209`).
Enabled but **unused by app and tests**, and therefore disableable to speed a CI
job: `[realtime]` (`:82`), `[studio]` (`:89`), `[inbucket]` (`:100`),
`[storage]` + `s3_protocol` (`:110`, `:123`), `[edge_runtime]` (`:358` — no
functions in the repo), and `[analytics]` on 54327 (`:372`), which is the
heaviest single container. `[db.pooler]` and the storage analytics/vector blocks
are already off.

CLI: `package.json` devDeps pin `supabase ^2.23.4`, resolved to **2.98.2** in the
lockfile, so `npx supabase` uses the local install after `npm ci` — no
`supabase/setup-cli` action needed unless a different version is wanted.

#### Compliance gap, quoted

`context/foundation/test-plan.md:143-156` (§5 Quality Gates):

```
| lint + typecheck     | local + CI | required (already wired — husky/lint-staged + CI) | …
| unit + integration   | local + CI | required after §3 Phase 1                        | …
| e2e on critical flow | CI on PR   | required after §3 Phase 4                        | …
```

Two of those rows are **factually false today**: `:151` claims typecheck is
already wired in CI (it is only in `.husky/pre-commit:14-15`), and `:152` has
been in force since Phase 1 completed (`test-plan.md:97`) while neither suite
runs. Phase 4 owns the CI gate (`test-plan.md:100`); Phase 3 (auth/route
protection, R4) is still `not started`. The table is also stale about Playwright
not existing (`:128`), already flagged at
`context/archive/2026-08-31-light-dark-mode/research.md:449`.

Documentation debt to fix alongside: `test-plan.md:151`, `test-plan.md:97-100`,
`test-plan.md:128`, and
`context/archive/2026-06-15-data-isolation-crud-integrity/plan.md:262`, which
claims `ci.yml` "keeps calling `npm test`" — it never has.

#### Prior art: three deferrals, never a refusal

- `context/archive/2026-06-15-data-isolation-crud-integrity/plan.md:128` —
  _"**No CI gate.** test-plan §3 assigns it to Phase 4."_
- `context/archive/2026-06-15-data-isolation-crud-integrity/research.md:197-198`
  — _"CI/Docker: deferred to test-plan §3 Phase 4."_
- `context/archive/2026-08-24-swallowed-error-propagation/plan.md:146` —
  _"**Not making CI run `npm test`.** Out of compliance with `test-plan.md:152`,
  but not this change's job."_
- The formal finding —
  `context/archive/2026-06-15-data-isolation-crud-integrity/reviews/impl-review.md:175-183`,
  **F10, severity OBSERVATION**: _"The `unit` project is Docker-free and would
  cost nothing to add … **Deferred by design** … Recorded as scope, not drift."_

**No document anywhere argues Docker is infeasible in GitHub Actions.** The
`unit`/`client` vs `integration` project split exists to protect _pre-commit_,
not CI — `vitest.config.ts:18-21`, `test-plan.md:374-378`.

Working precedent for editing `ci.yml`:
`context/archive/2026-08-31-light-dark-mode/plan.md:772-789` added `lint:colors`
to both pre-commit and CI, with the ordering lesson at that change's
`change.md:256-266` — _"Ordered before `typecheck` so it fails in ~50 ms rather
than after the slow checks."_

### Item 2 — Auth error reflection

#### The full path, both directions

Writers, the only two: `src/pages/api/auth/signin.ts:11` (the hardcoded
`"Supabase is not configured"`) and `:16` (the reflected `error.message`);
`src/pages/api/auth/signup.ts:11` and `:16`, identical.

Readers: `src/pages/auth/signin.astro:9`
(`Astro.url.searchParams.get("error")`) → `:18`
`<SignInForm serverError={error} lang={lang} client:load />`;
`src/pages/auth/signup.astro:9,18` the same. Then
`SignInForm.tsx:12-15` (props), `:17-24` (i18n instance wrapper), `:95`
`<ServerError message={serverError} />`; `SignUpForm.tsx:14-17,19-26,142`.
`ServerError.tsx:8` bails on falsy, `:11-14` renders `{message}` verbatim.
It does not call `useTranslation()` and takes no `lang`.

No middleware or layout reads `?error=`. `confirm-email.astro` never reads it.

**The precedent to copy is already in the repo.** `src/pages/cars.astro:37` is an
allowlisted closed-set reader:

```astro
Astro.url.searchParams.get("error") === "load_failed"
```

rendered at `:42` as `{showError && <Banner variant="error">{t("common.loadFailed")}</Banner>}`.
Six SSR pages write it — `dashboard.astro:36`, `entries.astro:34,52`,
`ai-chat.astro:38`, `entries/[type]/[id].astro:32,48`,
`ai-chat/[id].astro:45,65` — all as `Astro.redirect("/cars?error=load_failed")`.
This is structurally exactly what F8 needs, one page over.

A second precedent, for the client half: the `ChatError` discriminated union at
`src/components/hooks/useConversation.ts:15-19`, mapped from status at `:222-226`
and rendered through `switch (error.kind)` at `src/components/ai/ChatThread.tsx:145-156`.
Its docstring (`:138-143`) states the rule outright: _"`ChatError.kind` decides
the copy, never the server's own message."_ One wart not to copy:
`useConversation.ts:220` keys `conversation_not_found` on **string-matching** the
literal `"Conversation not found"`.

For the "ignore any value not in the set" half, `src/lib/safe-redirect.ts` is the
repo's precedent for guarding an untrusted URL-borne value.

#### What the mapper can key on

`@supabase/supabase-js` 2.105.3 / `@supabase/auth-js` 2.105.3.

`node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts:13-31` exposes both
discriminators on the base class:

```ts
export declare class AuthError extends Error {
  code: ErrorCode | (string & {}) | undefined; // :20
  status: number | undefined; // :22
}
```

`AuthApiError extends AuthError` with non-optional `status` (`:43-46`); guards
`isAuthError` (`:32`), `isAuthApiError` (`:47`), `isAuthRetryableFetchError`,
`isAuthWeakPasswordError`, `isAuthSessionMissingError` (`:94`).
`ErrorCode` at `error-codes.d.ts:6` is a real 86-member union.

**All of these are re-exported from `@supabase/supabase-js`** — `dist/index.d.mts:7`
carries `export * from "@supabase/auth-js"`, verified at runtime. This
**contradicts the comment at `src/middleware.ts:21-25`** claiming the guard is
not re-exported; that comment is stale or version-specific, and the middleware's
`error.name !== "AuthSessionMissingError"` string compare could be simplified
(out of scope, worth noting).

Reachable codes from these two calls: `invalid_credentials`,
`email_not_confirmed`, `user_banned`, `over_request_rate_limit`,
`validation_failed`, `email_address_invalid`, `unexpected_failure`,
`request_timeout`, `captcha_failed` (signin); `user_already_exists`/`email_exists`,
`weak_password`, `signup_disabled`, `email_provider_disabled`,
`over_email_send_rate_limit` (signup). The type file's own header warns the
server may return codes outside the list — **the mapper needs a default branch.**

**The `code: undefined` cases must be handled by name/status**, per
`node_modules/@supabase/auth-js/dist/module/lib/fetch.js:39-72` (code is read
from `data.code` only when the API-version header is ≥ `2024-01-01`, else
`data.error_code`, else `undefined`):

- `AuthRetryableFetchError` (`errors.js:217-220`) — thrown for non-Response
  failures with `status: 0` and for any 5xx (`fetch.js:25-31`).
- `AuthInvalidCredentialsError` (`errors.js:133-135`, status 400, code
  undefined) — thrown **locally** when neither email nor phone is supplied, i.e.
  **a blank form field reaches this path.**
- `AuthInvalidTokenResponseError` (status 500, code undefined).
- `AuthWeakPasswordError` is the exception — it sets `code: 'weak_password'`
  itself (`errors.js:240-242`).

Neither call throws: `GoTrueClient.js:853-858` catches and returns
`{ data, error }` for any `isAuthError` value, re-throwing only non-auth values.

Locally reachable conditions, from `supabase/config.toml`:
`enable_confirmations = false` (`:209`) means `email_not_confirmed` is **not**
reachable in local dev but **is** against a cloud project;
`minimum_password_length = 6` (`:175`) makes `weak_password` reachable;
`sign_in_sign_ups = 30` per 5 min (`:190`) makes `over_request_rate_limit`
reachable.

#### Where the log line goes

`src/lib/api-errors.ts` exposes three entry points. `apiErrorResponse` (`:186`)
is the wrong fit — the auth routes redirect, they do not return JSON.
`logSsrError` (`:212`) is the right _concept_ (its docstring at `:199-210` says
exactly "an `.astro` page has none to return — it redirects, or renders a
banner") but the wrong _mapping_: `:213` does
`isServiceError(err) ? mapErrorCode(err.code) : SERVER_ERROR`, and an `AuthError`
is not a `ServiceError`, so every auth failure would log `status: 500, code: ""`
including a 400 `invalid_credentials`.

**Cleanest shape: `logApiError(error, { route, method, surface: "ssr" }, mapping)`
with an explicit `ErrorMapping` from the new GoTrue table.** That is well-precedented
— `src/pages/api/ai/chat.ts:161-165` (429 + `extra`), `:175`, `:251`, `:309`, and
`src/lib/after-response.ts:31` all pass explicit mappings for non-Postgres
errors. Route literals follow convention: `"/api/auth/signin"` /
`"/api/auth/signup"`, `method: "POST"`.

One caution: **do not put the submitted email in `userId` or `extra`.** The
credential-stuffing trace F8 asks for is served by route + code + status.
`AuthError.message` reaching the log's `message` field via `messageOf` (`:223`)
is fine and is the point — it is operator-only.

#### F10 (the bonus)

`api-errors.ts:30-34` defines the five literals; `mapErrorCode` is the only
producer and `apiErrorResponse:196` the only emitter. **14 consumer sites** do
`json.error ?? t("common.anErrorOccurred")`:

`CarForm.tsx:89`; `CarList.tsx:57,67,105`; `RepairEntryForm.tsx:60`;
`RepairEntryEditForm.tsx:58`; `OilChangeEntryForm.tsx:49`;
`OilChangeEntryEditForm.tsx:56`; `InspectionEntryForm.tsx:58`;
`InspectionEntryEditForm.tsx:66`; `InsuranceEntryForm.tsx:69`;
`InsuranceEntryEditForm.tsx:68`; `EntryDetailEditor.tsx:64`;
**`DeleteConversationDialog.tsx:84`** — the fourteenth, which post-dates F10 and
is not in its list. `useConversation.ts:150` does _not_ follow the pattern; it is
already status-keyed.

**Do it client-side, as the follow-up prescribes.** Translating the server
literals instead would break `src/test/lib/api-errors.test.ts` in ~15 places —
the 12-row `TABLE` fixture at `:44-57`, the fallback row at `:66`, and
`:85-96`'s `it("draws every client message from a closed set of four literals")`
which hardcodes the `ALLOWED` array — plus the eight `toEqual` envelope
assertions in `src/test/pages/api/ai/chat.test.ts`. Mapping `res.status` to an
i18n key locally touches **no server code and no existing assertion**, and
`res.status` is already in scope at all 14 sites (each is inside an `if (!res.ok)`).
The natural shared helper mirrors `errorForResponse`. It also retires the
currently-dead `?? t("common.anErrorOccurred")` fallback.

#### Test surface

**Nothing currently asserts on the reflected auth error string**, so F8 breaks no
existing test. `src/test/pages/api/` has no `auth/` directory; there is no test
for `signin.ts`, `signup.ts`, or `ServerError.tsx`.

`e2e/auth.setup.ts:68-84` and `e2e/fixtures/app.ts:174-213` drive the real
sign-in form but only on the happy path, and never assert on `ServerError`. Both
pin `lang=en` + `theme=dark` cookies first (`auth.setup.ts:63-66`,
`app.ts:169-172`) precisely because every accessible name comes from i18n — so
new error copy is name-locatable in English under those fixtures.

New test homes: a pure `code → ErrorMapping` mapper test goes in `src/test/lib/`
(the `unit` project globs `.ts` and **excludes `.tsx` by design**,
`vitest.config.ts:47-48`); any React test of a translated `ServerError` must go
under `src/test/client/`.

### Item 3 — Streaming reply has no accessible progress signal

#### The render graph, and the constraint that reshapes the fix

```
ai-chat.astro:54 / ai-chat/[id].astro:72
  AppLayout → ChatShell.astro
    ConversationList.astro → DeleteConversationDialog (client:idle)
    <slot> → ChatThread (client:load)
      ChatThread → I18nextProvider → ChatThreadContent   (ChatThread.tsx:22-26)
        ScrollArea                                       (ChatThread.tsx:81)
          MessageBubble × n                              (ChatThread.tsx:85)
          StreamingText                                  (ChatThread.tsx:87)
        error <p role="status">                          (ChatThread.tsx:91-95)
        <form> Textarea + Ask/Stop                       (ChatThread.tsx:97-133)
```

`ChatThread.tsx:87` is the whole problem:

```tsx
{
  pending.active && <StreamingText text={pending.text} active />;
}
```

`active` is a hardcoded literal `true` — the prop is never `false` in production,
because the component is conditionally _unmounted_ instead. **A live region
inside `StreamingText` is removed from the accessibility tree at the exact moment
the terminal transition occurs, so it can never announce "reply complete".**
Hoist the region to `ChatThreadContent`, mounted unconditionally with empty text
content; keep `aria-busy` on `StreamingText`'s text container.

Note the existing error line at `ChatThread.tsx:91-95` has the same latent
weakness — it is conditionally mounted. It works in practice on most screen
readers (subtree insertion of `role="status"` is usually announced) but it is not
the robust pattern, and copying it verbatim would inherit the bug this item
exists to fix.

#### Stream state machine — there is no state enum

`src/components/hooks/useConversation.ts` (226 lines) exposes
`{ conversationId, messages, pending, error, send, stop }` (`:195`, interface at
`:32-39`). `PendingTurn` is `{ text: string; active: boolean }` (`:21-25`).

| Conceptual state        | Actual representation                                        | Line                  |
| ----------------------- | ------------------------------------------------------------ | --------------------- |
| idle                    | `pending = { text: "", active: false }`, `error === null`    | `:66`, `:87`          |
| request sent, no tokens | `active && text === ""` (set before `fetch`)                 | `:115`                |
| tokens arriving         | `active && text !== ""`                                      | `:164`                |
| any terminal            | `commitPending(status)` → `{ text: "", active: false }`      | `:84-94`              |
| aborted                 | `stop()` → `controller.abort()` → `commitPending("aborted")` | `:96-102`             |
| error                   | separate `error: ChatError \| null`                          | `:67`, union `:15-19` |

Three consequences for a transition announcer:

1. **"Thinking" vs "streaming" is derivable but unnamed** (`active && !text` vs
   `active && text`). The derivation is sound because `:114-115` clears
   `textRef`/`pending.text` _before_ the fetch, deliberately (`:111-113`).
   `StreamingText.tsx:20-22` documents the same gap.
2. **There is no separate abort state.** `stop()` and a normal `done` frame both
   land in the same `commitPending` and produce an identical `pending`. The only
   discriminator is `status` on the newly-appended message (`:93`) —
   `"aborted"` / `"complete"` / `"error"`. Announcing "Reply stopped" separately
   from "Reply complete" means reading `messages[messages.length - 1].status`, or
   extending the hook to expose a terminal reason.
3. **An abort before the first token appends nothing at all** —
   `commitPending` returns early on an empty buffer (`:92`). A `messages.length`-keyed
   announcer would miss it entirely.

A fourth, subtler one: an `{"error": …}` SSE frame sets `error` but **keeps the
stream alive** (`:168-171`). "Error appeared" and "reply ended" are two
independent transitions that can be seconds apart.

Frame contract: `src/lib/chat.ts:24-28` — `{meta}` | `{text}` | `{error}` |
`{done: MessageStatus}`, terminator `[DONE]` at `:31`.

#### a11y precedents — the repo has none for this

Complete grep of `src/` for `aria-live`, `role="status"`, `role="alert"`,
`aria-busy`, `sr-only`, `visually-hidden`:

| file:line                             | hit                             |
| ------------------------------------- | ------------------------------- |
| `AppSidebar.astro:62,98`              | `role="group" aria-label=…`     |
| `MobileSidebarTrigger.tsx:38,43`      | `className="sr-only"`           |
| `MobileSidebarTrigger.tsx:92,124`     | `role="group"`                  |
| `ai/ChatThread.tsx:92`                | `role="status"` (error line)    |
| `ai/ChatThread.tsx:120`               | `aria-label` on the Textarea    |
| `ai/ConversationList.astro:39,78`     | `aria-label`                    |
| `auth/PasswordToggle.tsx:14`          | `aria-label` — **untranslated** |
| `ui/dialog.tsx:63`, `ui/sheet.tsx:69` | `sr-only`                       |

**Zero hits for `aria-live`, `role="alert"`, `aria-busy`, `visually-hidden`.**
This change introduces the repo's first `aria-live` and first `aria-busy`.

Visually-hidden: use **`sr-only`** — Tailwind v4 built-in, used in 4 places, and
confirmed compiled into the built CSS. No shared `<VisuallyHidden>` component
exists in `src/components/ui/` (12 files, none of them one). Radix ships one via
`radix-ui@^1.5.0` (`node_modules/radix-ui/dist/index.d.ts:69-70`) but nothing
imports it.

**No live-region ancestor exists above the markdown container** — the full chain
(`Layout` → `AppLayout` → `ChatShell` → `ChatThread` → `ScrollArea` → the
`space-y-6` wrapper → `StreamingText` → `Markdown`) has none, and
`grep -rn "aria-live|role=\"status\"" src/layouts src/pages` returns nothing. The
error `<p>` at `ChatThread.tsx:92` is a **sibling** of the `ScrollArea`, not an
ancestor, so it creates no spam. There is no inherited live scope to untangle
first — but the plan must not put `aria-live` on `ChatThread.tsx:82`'s wrapper or
the `ScrollArea` viewport, both of which contain the markdown.

#### The Stop button and i18n

`ChatThread.tsx:122-132` swaps Ask → Stop for the whole streaming window
(`aiChat.stop` = "Stop" / "Zatrzymaj", `en.json:184` / `pl.json:184`). Note
`aiChat.sending` ("Sending…" / "Wysyłam…", `:181`) is now **dead** — nothing
references it.

The `aiChat` namespace occupies `en.json:178-198` and `pl.json:178-198`,
line-for-line aligned. Files are 2-level nested, 2-space indent, grouped
semantically and **not alphabetized**. Top-level order in both:
`nav, sidebar, common, dashboard, entries, cars, aiChat, landing, auth`.
Slot the 2 new keys **after `"stop"` (line 184)**, keeping the composer cluster
(`ask`/`sending`/`assistant`/`you`/`stop`) together and ahead of the thread-list
cluster starting at `newChat`. Suggested: `"responding"` / `"responseComplete"`;
PL "Asystent odpowiada…" / "Odpowiedź gotowa". If a stopped variant is also
announced, `aiChat.interrupted` ("Answer interrupted" / "Odpowiedź przerwana",
`:192`) already exists and can be reused verbatim.

**No key-parity gate exists** — grepped `src/`, `e2e/`, `integration/`,
`scripts/`, `.github/`; the only reference to the locale files anywhere is the
import at `src/i18n/config.ts:1-2`.

#### Testing and lint

**No test renders `ChatThread` or `StreamingText`.** `src/test/client/` holds
only `useConversation.test.tsx` (495 lines, 19 cases, `renderHook` only — never
`render`). The new region has no existing component-test home; the planner is
creating the first one. A `.tsx` test **must** live under `src/test/client/`.

The closest existing harness is `controllableBody()` at
`useConversation.test.tsx:40-63`, which holds a stream open until the test pushes
or closes — exactly the fixture a "was the transition announced" test needs. The
SSE fixture at `:74-80` is reusable verbatim. Practical note: rendering
`ChatThread` pulls in `I18nextProvider` + both locale JSONs + `react-markdown`
under jsdom — heavier than any existing client test; asserting on the region in
isolation with a bare `I18nextProvider` wrapper is the lighter option.

Lint: `eslint-plugin-jsx-a11y@6.10.2` is installed and the **recommended** set
runs at `error` — but **only for `.astro` files**. `eslint-plugin-astro` wraps
each rule as `astro/jsx-a11y/<rule>` and short-circuits on
`if (!getSourceCode(context).parserServices?.isAstro) return {}`
(`node_modules/eslint-plugin-astro/lib/index.js:4064`). **`.tsx` gets zero a11y
linting.** Nothing proposed would trip a rule even if it did apply.

What _will_ bite is the strict TS/React config: `tseslint.configs.strictTypeChecked`

- `stylisticTypeChecked` (`eslint.config.js:15`), `react-compiler` at `error`
  (`:63`), `react-hooks` recommended (`:61`), `prettier` as an error-level rule
  (`:96`). **react-compiler rejects ref reads/writes during render** — so detect the
  transition in a `useEffect`, not a render-time ref compare, which is the natural
  first implementation.

`scripts/lint-colors.sh` greps for palette literals, raw hex, and `rgb()/hsl()`
(`:79-81`), excluding `src/components/ui/` (`:28`). It cannot see `sr-only`,
`role`, or `aria-*`. No constraint here.

#### The R6 spec question

`test-plan.md:54` (risk): _"**AI progress-feedback regression** — no continuous
visible feedback during streaming response (PRD names its absence a regression) |
Medium | Medium"_. `test-plan.md:87` (response guidance): proof is _"The user sees
continuous progress from submit through to streamed response"_; the claim to
challenge is _"HTTP 200 means the user saw feedback"_; cheapest layer _"one
Playwright e2e"_; anti-patterns _"`waitForTimeout`; asserting answer content
instead of the presence of progress"_. Phase 4 charter at `test-plan.md:100`.
The PRD anchor is `context/foundation/prd.md:92` (and `:50`).

After the fix lands, the spec is three role-based waits:

```
signedInPage → seed a car → goto /ai-chat?new=1
→ wait for astro-island[ssr] count 0        (hydration, per fixtures/app.ts:199)
→ getByLabel("Ask anything about your car…").fill(q)
→ getByRole("button", { name: "Ask" }).click()
→ expect(<the status region>).toHaveText(/Assistant is replying/)
→ expect(getByRole("button", { name: "Stop" })).toBeVisible()
→ expect(<the status region>).toHaveText(/Reply complete/)
```

**Two gotchas the plan must handle.** (a) `getByRole("status")` becomes
**ambiguous** — `ChatThread.tsx:92` is also `role="status"`, so Playwright strict
mode fails whenever both are present. Give the new region an accessible name
(`aria-label`) or filter. (b) The locale is pinned to `en` by the fixture
(`e2e/fixtures/app.ts:169-172`), so assert the EN strings.

**Does it have to hit the real model?** Today, yes, and there is zero precedent
for avoiding it: `grep -rn "page.route|fulfill|waitForResponse|context.route" e2e/`
returns **exactly one hit, and it is prose** — `e2e/README.md:64`: _"E2E hits the
**real** OpenRouter model. No `page.route` interception, nothing mocked — the
decision is fidelity over determinism."_ Three honest options:

1. **Real model (status quo).** Matches the written decision. ~1 of 50 daily
   free-tier requests per run; `retries: 0` means a rate-limited day is a red
   build for reasons unrelated to R6.
2. **Stub the SSE stream via `page.route` + `route.fulfill`.** Deterministic, no
   quota, and can drive a slow-first-token case that is _impossible_ to provoke
   against a real model — arguably better R6 coverage. But it stops being
   end-to-end, and it requires amending `e2e/README.md:62-66`.
3. **Split.** A stubbed spec for the transition assertions (R6's actual claim)
   plus the real-model path kept in a separate quota-aware spec or a manual item.
   This is what `test-plan.md:15-21`'s "cheapest layer that gives real signal"
   principle points at, since R6 is about _the UI's loading-state transitions_,
   explicitly not the model's answer.

Whichever is chosen, note this **reconciles with OUT OF SCOPE item A**: no
existing spec touches OpenRouter, so e2e-in-CI needs no `OPENROUTER_API_KEY`
today. Only option 1 creates the collision.

### Item 4 — Config hygiene

**(a) The Cloudflare token typo — confirmed, blast radius zero.**
Key names only: `.env` has `SUPABASE_URL` (1), `SUPABASE_KEY` (2),
**`ClOUDFLARE_API_TOKEN` (3)**, `SUPABASE_SERVICE_ROLE_KEY` (6).
`.env.example` has `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — **and no Cloudflare token at all**, so there is
nothing to correct there; the only question is whether to _add_ it as a
documented local var. Both `.env` and `.dev.vars` are gitignored (`.gitignore:18`
and `:24`, verified with `git check-ignore -v`), so the typo has never been
committed. The only repo consumer of the correct name is `ci.yml:44`
(a GitHub secret, unaffected). Docs reference it at
`context/foundation/infrastructure.md:78,80,119` and
`context/deployment/deploy-plan.md:133,146`.

Two adjacent env drifts, not in scope but one line each: `.env` lacks
`OPENROUTER_API_KEY`; `.dev.vars` lacks `SUPABASE_SERVICE_ROLE_KEY`.

**(b) Missing `site` — the evidence favours dropping `sitemap()`.**
Nothing consumes a sitemap: no `robots.txt` anywhere; `public/` holds only
`.assetsignore`, `favicon.png`, `template.png`; no `sitemap` reference in any
layout, page, or component; and **no SEO meta at all** —
`src/layouts/Layout.astro:25-29`'s `<head>` is charset, viewport, favicon,
`<title>`, nothing more. Zero hits for `Astro.site`, `import.meta.env.SITE`,
`canonical`, or `og:url`. Setting `site` would produce `sitemap-index.xml` +
`sitemap-0.xml` that nothing would ever read, on an app that is auth-gated except
the landing page. Either fix is one line; removing also drops a dependency.

The canonical URL, if `site` is chosen: `https://car-booklet.carbooklet.workers.dev`
(`context/deployment/deploy-plan.md:9` frontmatter, corroborated at `:184,195,203-204,212`).

The warning text in `change.md:147` is the auditor's transcription — **no build
log is stored anywhere in `context/`**, so re-running `npm run build` is the only
way to pin it exactly.

**(c) `package.json` name — 2 lockfile lines, no live coupling.**
Every occurrence outside `node_modules`: `package.json:2`;
`package-lock.json:2` and `:8` (both plain string literals, no integrity hash
involves the name — `npm install` regenerates both); `README.md:26,27` (upstream
clone URL, correct as-is); `src/lib/config-status.ts:16` (upstream docs link in
the missing-config banner, correct as-is); **`supabase/config.toml:5`**
(`project_id` — local Docker stack only, renaming disrupts existing volumes,
probably decline); plus historical records in
`context/foundation/tech-stack.md:2,24`,
`context/changes/bootstrap-verification/verification.md:3,17,39,54`,
`context/deployment/deploy-plan.md:378,381`,
`context/archive/2026-06-09-sidebar-navigation/research.md:141`.

**`wrangler.jsonc` does not derive from it** — `wrangler.jsonc:3` hardcodes
`"name": "car-booklet"`. The Worker was renamed back in May; Appendix B
(`context/deployment/deploy-plan.md:374-381`) marks that row **Fixed** and this
one _"Cosmetic | Optional — not required for deploy"_.

**(d) Not in item 4, but the same family and demo-visible:**
`src/layouts/Layout.astro:10` — `const { title = "10x Astro Starter" } = Astro.props;`.
Any page that omits `title` shows the starter name in the browser tab.

**`wrangler.jsonc` in full** (17 lines): `$schema`; `name: "car-booklet"` (`:3`);
`main: "@astrojs/cloudflare/entrypoints/server"` (`:4`);
`compatibility_date: "2026-05-08"` (`:5`); `compatibility_flags: ["nodejs_compat"]`
(`:6-8`); one binding — `ASSETS` from `./dist`, `not_found_handling: "404-page"`
(`:9-13`); `observability.enabled: true` (`:14-16`). **No `vars`, no KV/D1/R2, no
`IMAGES` or `SESSION` bindings, no `env.*` split, no `routes`.**

On the flagged prod-upload concern (evidence only, out of scope): the config
names the _same_ Worker that is live, with no dev/prod split, so any wrangler
operation from this repo targets production by default; the `IMAGES`/`SESSION`
bindings the audit saw announced appear **nowhere in `wrangler.jsonc`** — they
are injected by `@astrojs/cloudflare` at dev time, so the config file offers no
lever to redirect them; and `package.json:6` is `"dev": "astro dev"`, not
`wrangler dev`, with no `--remote` anywhere. The config neither proves nor
prevents the behaviour. **This does, however, bear directly on item 1's e2e
stage**, whose `webServer` is `npm run dev`.

### Item 5 — Thread-delete manual re-verification (note only)

#### How the delegated dialog works

`ConversationList.astro:74-98` renders per row a plain
`<button type="button" data-delete-conversation={id} data-conversation-title={title}
aria-label={`${t("common.delete")} — ${title}`}>` with an inline trash SVG, as a
**sibling** of the row's `<a href={/ai-chat/${id}}>`—`:61-62`explains a button
nested in an anchor is invalid content and swallows the click.`:105`mounts
**one**`<DeleteConversationDialog client:idle lang={lang} />`, and only when
`conversations.length > 0`.

`DeleteConversationDialog.tsx:50-67` attaches a single `document`-level `click`
listener, does `event.target.closest("[data-delete-conversation]")`, calls
`event.preventDefault()` (`:56`, to stop the row link navigating), reads both
data attributes, clears prior error, sets `target`. The dialog opens because
`AlertDialog open={target !== null}` (`:99`) and shows the thread's own title
(`:107`). Confirm → `handleConfirm` (`:76-96`) → `fetch("/api/ai/conversations/${id}", { method: "DELETE" })`;
on `!res.ok` it renders `json.error` inline (`:108`) and leaves the dialog open;
on success **`window.location.assign("/ai-chat")`** — a full navigation, not
client-side removal (`:88-91` documents why).

Server: `src/pages/api/ai/conversations/[id].ts` — 401 no user (`:22-24`), 400
non-uuid (`:27-30`), 503 no client (`:33-35`), **404 when not yours** (`:42-44` —
never 403), 200 `{success:true}`; messages cascade (`:45-46`).

After the redirect, `src/pages/ai-chat.astro`: no `selectedCarId` → `/cars`
(`:15-17`); re-list (`:35`); **if `?new` absent and list non-empty → redirect to
`conversations[0].id`** (`:48-51`, ordered `updated_at DESC`); empty list → render
the empty composer with `activeId={null}`, `noConversations` text
(`ConversationList.astro:50-51`), **and no dialog mounted** (`:105`).

#### Two things to put in the checklist

- **Esc is probably dead.** `AlertDialog` is controlled by `open` with **no
  `onOpenChange` handler** (`DeleteConversationDialog.tsx:99`); only
  `AlertDialogCancel onClick={close}` (`:110`) can close it. Exactly the kind of
  regression an islands rewrite introduces, and invisible to the API-level tests.
- **`client:idle` hydration.** Before hydration a click on the trash button does
  nothing at all (bare `<button type="button">` outside the anchor). A tester
  clicking instantly on a cold load may see a dead button and report a false bug.
  The checklist should say "let the page settle first".

#### The manual checklist

Preconditions: local Supabase up, `npm run dev`, signed in, a car selected
(otherwise every `/ai-chat` route bounces to `/cars`). Create **three** threads on
the selected car first (`/ai-chat?new=1` → send a message → repeat).

1. Go to `/ai-chat`. **Observe:** redirected to the most recent thread; three rows
   in the rail; active row has `bg-accent` and `aria-current="page"`; each row
   shows a title and a relative timestamp.
2. Wait ~1 s for `client:idle`. Hover a **non-active** row's trash icon.
   **Observe:** it tints to `text-destructive`.
3. Click that trash icon. **Observe:** (a) the URL does **not** change — you were
   not navigated into that thread; (b) a confirm dialog appears; (c) **the dialog
   names the exact thread you clicked** — the capability F7's rewrite added, and
   the single highest-value assertion here.
4. Press **Esc**. **Record what happens** — per the note above, if it stays open
   that is a real (small) finding, not tester error.
5. Click **Cancel**. **Observe:** dialog closes, list unchanged.
6. Click a **different** row's trash icon. **Observe:** the dialog shows _that_
   row's title — proves `target` is re-read per click, not cached.
7. Click **Delete**. **Observe:** label switches to the `aiChat.deleting` string,
   both buttons disable, then a full page load to `/ai-chat` which redirects to
   the most recent remaining thread. Row gone. Two remain.
8. **Edge case — delete the currently-open thread.** Trash icon on the
   **highlighted** row → confirm. **Observe:** full navigation → `/ai-chat` →
   redirect to the one remaining thread. Must **not** 404 and must not stay on
   the dead URL.
9. **Edge case — delete the last remaining thread.** **Observe:** you land on
   `/ai-chat` itself (no further redirect — `ai-chat.astro:49` short-circuits on
   an empty list); "no conversations" empty state; "New chat" still present;
   empty composer. **No trash icons and no dialog exist here** — correct, not a bug.
10. **Persistence.** Hard-refresh; deleted threads stay gone. Optionally confirm
    in Studio that the `messages` rows cascaded.
11. **Optional negative check.** In DevTools:
    `fetch('/api/ai/conversations/00000000-0000-0000-0000-000000000000', {method:'DELETE'})`
    → `404 {"error":"Not found"}`.

Item 4.10's original wording — _"Delete a thread from the list: confirm dialog,
redirect to /ai-chat, thread gone"_ — is the minimum this must re-establish;
steps 3, 7 and 10 cover it, and 8–9 extend it.

#### Coverage claim — confirmed

`e2e/` has three specs, none touching `/ai-chat`; the only `ai-chat` string there
is prose at `e2e/README.md:80`. Zero hits for `DeleteConversation` or
`ConversationList` in `e2e/`, `integration/`, or `src/test/`.

What **does** exist: `src/test/pages/api/ai/conversations.test.ts:34` covers the
DELETE route with the service mocked (401 `:42`, 400 without touching the DB
`:51`, 503 `:60`, 404 not-yours `:69`, 200 own `:81`, error mapping `:89`);
`integration/isolation-conversations.test.ts:47` covers R3 against real RLS,
including `:330` (B cannot delete A's row), `:342` (messages survive), `:355` (A
deletes own thread, messages go), `:367` (car-delete blast radius);
`src/test/client/useConversation.test.tsx` covers URL bookkeeping only
(`:254,266,444`). **The service and route layers are well covered; the
delegated-click → dialog → redirect chain has zero coverage** — precisely the
layer F7 rewrote.

## Code References

Permalink base: `https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/`
(`context/changes/pre-demo-fixes/` is untracked at this commit and has no permalink.)

**Item 1 — CI**

- [`.github/workflows/ci.yml:10-25`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/.github/workflows/ci.yml#L10-L25) — the whole `ci` job; no tests, no typecheck
- [`.github/workflows/ci.yml:29`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/.github/workflows/ci.yml#L29) — `needs: ci`, the deploy coupling any new job must reckon with
- [`vitest.config.ts:32-87`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/vitest.config.ts#L32-L87) — the three projects
- [`integration/globalSetup.ts:29-37`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/integration/globalSetup.ts#L29-L37) — the localhost guard that refuses the existing `SUPABASE_URL` secret
- [`integration/fixtures/env.ts:20-43`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/integration/fixtures/env.ts#L20-L43) — the three required env vars
- [`playwright.config.ts:46-51`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/playwright.config.ts#L46-L51) — `webServer: npm run dev`
- [`playwright.config.ts:16-18`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/playwright.config.ts#L16-L18) — `retries: 0`, a written decision
- [`supabase/config.toml:82-372`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/supabase/config.toml#L82-L372) — the services disableable for a CI stack

**Item 2 — auth errors**

- [`src/pages/api/auth/signin.ts:11,16`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/pages/api/auth/signin.ts#L11-L16) / [`signup.ts:11,16`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/pages/api/auth/signup.ts#L11-L16) — the reflection
- [`src/components/auth/ServerError.tsx:11-14`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/auth/ServerError.tsx#L11-L14) — renders it verbatim, not localized
- [`src/pages/cars.astro:37,42`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/pages/cars.astro#L37-L42) — **the closed-set precedent to copy**
- [`src/components/hooks/useConversation.ts:15-19`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/hooks/useConversation.ts#L15-L19) — `ChatError` union; client-side precedent
- [`src/components/ai/ChatThread.tsx:145-156`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/ChatThread.tsx#L145-L156) — `switch (error.kind)` → i18n
- [`src/lib/api-errors.ts:160-180`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/lib/api-errors.ts#L160-L180) — `logApiError`, the right entry point
- [`src/lib/api-errors.ts:212-214`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/lib/api-errors.ts#L212-L214) — `logSsrError`, right concept / wrong mapping for `AuthError`
- [`src/middleware.ts:21-25`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/middleware.ts#L21-L25) — the stale "not re-exported" comment
- [`src/test/lib/api-errors.test.ts:85-96`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/test/lib/api-errors.test.ts#L85-L96) — the closed-set assertion F10 must not break

**Item 3 — streaming a11y**

- [`src/components/ai/ChatThread.tsx:87`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/ChatThread.tsx#L87) — **the conditional mount that reshapes the fix**
- [`src/components/ai/ChatThread.tsx:91-95`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/ChatThread.tsx#L91-L95) — the existing `role="status"`; also the strict-mode collision risk
- [`src/components/ai/StreamingText.tsx:26-33`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/StreamingText.tsx#L26-L33) — the caret with no role
- [`src/components/hooks/useConversation.ts:84-115`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/hooks/useConversation.ts#L84-L115) — `commitPending` + the pre-fetch clear; the transitions to key on
- [`src/components/hooks/useConversation.ts:92`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/hooks/useConversation.ts#L92) — empty-buffer abort appends nothing
- [`src/i18n/locales/en.json:178-198`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/i18n/locales/en.json#L178-L198) / [`pl.json:178-198`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/i18n/locales/pl.json#L178-L198) — the `aiChat` namespace
- [`src/test/client/useConversation.test.tsx:40-80`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/test/client/useConversation.test.tsx#L40-L80) — `controllableBody()` + SSE fixture, reusable

**Item 4 — config**

- [`astro.config.mjs:12`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/astro.config.mjs#L12) — `sitemap()` with no `site`
- [`package.json:2`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/package.json#L2) — the starter name
- [`wrangler.jsonc:3`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/wrangler.jsonc#L3) — already `car-booklet`, decoupled from package.json
- [`src/layouts/Layout.astro:10`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/layouts/Layout.astro#L10) — the demo-visible default title

**Item 5 — delete flow**

- [`src/components/ai/ConversationList.astro:74-105`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/ConversationList.astro#L74-L105) — the delegation targets and the single mount
- [`src/components/ai/DeleteConversationDialog.tsx:50-99`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/components/ai/DeleteConversationDialog.tsx#L50-L99) — listener, `preventDefault`, controlled `open` with no `onOpenChange`
- [`src/pages/ai-chat.astro:48-51`](https://github.com/sAleksander/CarBooklet/blob/3e3e6f590c77276cd4c631db8d5eeb0fe918ae69/src/pages/ai-chat.astro#L48-L51) — the post-delete redirect branch the edge cases exercise

## Architecture Insights

**One rule already governs three of the five items.** `src/lib/api-errors.ts:9-19`
states it: every failure produces two artifacts with different audiences — the
operator gets the full structured detail, the client gets a fixed generic string
and a status that means what it says, and _nothing the database authored crosses
that boundary_. Item 2 is that rule applied to GoTrue instead of PostgREST, with
one added freedom the docstring does not cover: **a GoTrue `code` is a closed
enum, unlike Postgres prose, so it _may_ cross the boundary — as a code, never as
a message.** F10 is the same rule's unfinished half on the client side.

**"Closed set, resolved at the render site" is the established i18n pattern for
errors, and it exists twice already.** Server-side at `cars.astro:37` via `getT`;
client-side at `ChatThread.tsx:145-156` via `switch (error.kind)`. Both new
error surfaces (auth codes, streaming state) should look like one of these two,
not invent a third. The one thing not to copy is `useConversation.ts:220`'s
string-match on a server literal.

**Islands are per-component, and that shapes both a11y and i18n.** There is no
app-root i18n provider — each island calls `createClientI18n(lang)` and wraps
itself (`src/i18n/client.ts:8-20`), which is exactly the cost F7 attacked when it
collapsed N per-row dialogs into one delegated dialog. The same
island-boundary thinking explains item 3's real constraint: **a React island's
conditional rendering is also an accessibility-tree lifetime**, and a live region
must outlive the state it reports on. The general lesson —
_a live region must be mounted for the whole lifetime of the process it
announces, never conditionally with it_ — is worth a `/10x-lesson` entry.

**The project's gates are inverted: pre-commit is strictly stronger than CI.**
`.husky/pre-commit` runs lint + colors + typecheck + tests; `ci.yml` runs lint +
colors + build. The bypassable local hook is the real gate and the unbypassable
remote one is not — which is also why `test-plan.md:151`'s claim went unnoticed.

**`astro check` is load-bearing beyond type safety.** `tsconfig.json:3` includes
`**/*`, making it the only gate that type-checks `integration/` and `e2e/` — so
adding `typecheck` to CI protects the test code that the test jobs run.

**No lessons file exists.** `context/foundation/lessons.md` is absent and
`/10x-lesson` has never run here. That role is split across `CLAUDE.md` (durable
rules), `test-plan.md` §6 (a cookbook that "fills in as phases ship"), and
per-change `reviews/impl-review.md` files where the actual pitfall knowledge is
siloed — e.g. F7's "one island per row" anti-pattern, currently discoverable only
by reading a review doc inside an unarchived change.

## Historical Context (from prior changes)

- `context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md:6-36`
  — **F8** in full. Confirms the fix shape (`?error=invalid_credentials`,
  translate through existing i18n, log via `logApiError` with
  `route: "/api/auth/signin"`), and notes _"`api-errors.ts` would need a second
  table keyed on GoTrue's error names rather than PostgREST codes."_
- Same file, `:75-106` — **F10** in full, including the prescription to map
  `res.status` client-side so the eight `toEqual` assertions stay untouched, and
  the sequencing note: _"Worth doing together with F8 — that fix introduces
  translated auth errors, and doing both at once gives the app one consistent
  story about who translates what."_
- `context/archive/2026-08-24-swallowed-error-propagation/plan.md:122-147`
  ("What We're NOT Doing") — the three exclusions that scoped F8/F10 out at the
  time: `:129-130` the auth routes ("same defect class, different subsystem"),
  `:131-132` no `code` field in the envelope, `:133-136` no i18n for API errors.
- `context/changes/ai-chat-history/reviews/impl-review.md:279-310` — **F7**, the
  delete-flow rewrite, decided via "Fix A, adapted" and closing with
  **_"Needs a browser re-check: this reworks the delete flow that manual item
  4.10 covered."_** That sentence is the entire basis for item 5.
- `context/changes/ai-chat-history/follow-ups/review-fixes.md:39-45` — the same
  re-check recorded as an open follow-up.
- `context/archive/2026-06-15-data-isolation-crud-integrity/reviews/impl-review.md:175-183`
  — the CI gap as a formal OBSERVATION, _"Deferred by design … Recorded as scope,
  not drift."_
- `context/archive/2026-08-31-light-dark-mode/plan.md:772-789` — the working
  precedent for adding a step to both pre-commit and CI.
- `context/deployment/deploy-plan.md:374-381` — Appendix B, where the
  `package.json` rename has sat as "Optional" since 2026-05-24.
- `context/changes/bootstrap-verification/verification.md` — a 2026-05-23
  bootstrapper record with **no `change.md`**, so no `status` field; it is the
  origin of both the `10x-astro-starter` name and (per `:160`) the hand-written
  `.env` where the typo was introduced. Its `:159` recommendation to run
  `npm audit fix` (1 HIGH, 9 MODERATE) was never actioned — out of scope, noted
  so it is a deliberate non-item rather than an oversight.

## Related Research

- `context/changes/ai-chat-history/research.md` — the streaming/SSE architecture
  item 3 builds on.
- `context/archive/2026-08-24-swallowed-error-propagation/research.md` — the
  error-boundary model item 2 extends; `:412` raises the CI gap as its Open
  Question #6.
- `context/archive/2026-06-15-data-isolation-crud-integrity/research.md:197-198`
  — where the integration suite's CI deferral was first recorded.
- `context/foundation/test-plan.md` — §2 risk map (R6 at `:54`), §3 phases
  (`:89-100`), §5 gates (`:143-156`), §7 deliberate non-tests (`:402-434`).

## Open Questions

**For the planner to decide (the two `change.md` named, now with evidence):**

1. **One workflow or two?** The `deploy` job's `needs: ci` (`ci.yml:29`) means a
   new job gates deploy only if added to `needs:`. Cheap gate (typecheck +
   `npm test`, ~9 s combined) clearly belongs in `ci`. Integration needs its own
   env block because of the localhost guard. E2E is the only genuinely slow one.
2. **E2E on PR or `main` only?** `test-plan.md:153` says "CI on PR". Note
   `retries: 0` is deliberate, `fullyParallel: true` has no `workers` cap, and
   the Supabase `sign_in_sign_ups = 30`/5 min budget is shared.

**Newly surfaced, and genuinely open:**

3. **Should `webServer.command` become `npm run build && npm run preview`?** It
   sidesteps the flagged prod-upload question entirely and is faster in CI. This
   is the one place item 1 and the "flagged for the user's own verification"
   section actually touch.
4. **Does the R6 spec get written, and against what?** Three options laid out
   above. Option 2 or 3 requires amending the written decision at
   `e2e/README.md:62-66` — a deliberate fork, not an incidental one.
5. **Is F10 in or out?** Evidence says in and cheap: 14 mechanical call-site
   edits plus one helper, no server change, no assertion broken, and it closes
   the EN/PL asymmetry F8 would otherwise leave half-open.
6. **Does an i18n key-parity test get added?** None exists; two of the five items
   add keys to both locales; a parity test must tolerate CLDR plural suffixes
   (`_few`/`_many`).
7. **Sitemap: set `site` or drop the integration?** Evidence leans to dropping —
   no consumer, no SEO surface, auth-gated app.
8. **Fold in `Layout.astro:10`'s `"10x Astro Starter"` default title?** Same
   family as item 4c and the only one of them a demo audience can see.
9. **Fix the stale docs in the same change?** `test-plan.md:151` (typecheck
   "already wired — CI") and `:128`/`:97-100` (Playwright "none yet") will be
   made false in the opposite direction by this work.

**Not this change's work, recorded because research touched them:**
`src/middleware.ts:21-25`'s stale re-export comment;
`src/components/auth/PasswordToggle.tsx:14`'s untranslated `aria-label`;
the dead `aiChat.sending` key; `e2e/README.md:90-93`'s known duplicate
"Add car" accessible name; `context/changes/ai-chat-history/` still
`status: impl_reviewed` and never archived.
