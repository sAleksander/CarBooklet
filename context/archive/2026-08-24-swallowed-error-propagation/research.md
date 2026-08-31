---
date: 2026-08-24T17:34:34+02:00
researcher: Aleksander
git_commit: 6899ecdc06a7177c38716898a695deab97c4b68b
branch: main
repository: CarBooklet
topic: "Propagate swallowed errors at the API and SSR boundary"
tags: [research, codebase, error-handling, api-routes, postgrest, rls, observability, i18n]
status: complete
last_updated: 2026-08-24
last_updated_by: Aleksander
---

# Research: Propagate swallowed errors at the API and SSR boundary

**Date**: 2026-08-24T17:34:34+02:00
**Researcher**: Aleksander
**Git Commit**: `6899ecd` (`src/` unchanged since `a7c9102`; both later commits are e2e-only, so every `file:line` in `change.md` still resolves)
**Branch**: main
**Repository**: CarBooklet

> File references are local `path:line` rather than GitHub permalinks. The `origin` remote embeds a plaintext PAT in `.git/config`, so permalink generation was skipped deliberately; see the note at the end of Open Questions.

## Research Question

From `change.md`: the audit produced a _symptom inventory_ of every `catch` in `src/` — swallows that answer infrastructure faults with 404, SSR catches that redirect with no log, and 20 sites that echo raw Postgres text to the client. Research must decide **what the correct answer at each boundary is**, across four areas: the real failure modes reaching each catch, the existing error contract and its consumers, the house pattern and what tests lock in, and where `console.error` actually goes in production.

Scope confirmed at kickoff: **all three findings**, service layer **in scope** (propose the error shape), observability researched against **repo config + current Cloudflare docs**.

## Summary

**The audit is correct, and the mechanism is now proven rather than assumed.** `getCarById` returns `null` — never throws — when the id is a well-formed uuid belonging to another user (probed live: PostgREST answers `406 PGRST116`, which `cars.ts:13` maps to `null`). Therefore `.catch(() => null)` at three sites is _incapable_ of catching the authorization case. Everything it can catch is a genuine fault, and every one of them becomes `404 {"error":"Not found"}` with no log line.

Four findings materially change the shape of the work versus what `change.md` anticipated:

1. **There is a single root cause upstream of all three findings.** All 24 service throw sites do `throw new Error(res.error.message)`, discarding `.code`, `.details`, `.hint` and `status` (`src/lib/services/cars.ts:6,14,21,27,33`; `src/lib/services/entries.ts:27,42,58,197,263,341,413` and siblings). That flattening is why routes have nothing to branch on and default to either 404 or a raw echo. **Fix the service error shape first; the ~38 route-level fixes become mechanical.**

2. **Finding 3 is bigger and more user-visible than recorded.** It is **20 sites, not 14**, and **14 DOM elements render `json.error` verbatim** to the user (`CarList.tsx:124`, `CarForm.tsx:226`, eight entry-form error paragraphs, `EntryDetailEditor.tsx:166`, plus two already-generic AI surfaces). Raw Postgres constraint and RLS-policy text is on screen today, not merely in a response body.

3. **The house pattern already has a decision behind it.** `chat.ts`'s generic-500 + `console.error` was not a style choice — it was produced by an impl-review that _explicitly rejected `(err as Error).message` as a response body_ (`context/changes/ai-car-chat/reviews/impl-review.md:80-88`, fixed in `50833b5`). Finding 3's 20 surviving sites are the same defect already adjudicated once in this repo. That settles "is chat.ts the pattern" as precedent, not preference.

4. **Observability plumbing is already correct; the gap is log _shape_.** `wrangler.jsonc:13-15` sets `observability.enabled: true`, so `console.error` lands in persisted, queryable Workers Logs (3-day Free / 7-day Paid retention, 100% sampling). Copying `chat.ts`'s `console.error("[tag] msg:", err)` twenty times would produce twenty _unqueryable_ string blobs. Cloudflare indexes the top-level keys of a **single logged object** — so the log shape, not the log's existence, is the thing to get right.

Two assumptions from `change.md` are refuted outright: **`23505` (duplicate) is unreachable** — the schema has zero UNIQUE and zero CHECK constraints — and **`42501` should map to 401, not 403**, because the anon downgrade in supabase-js is silent and `42501` in this app almost always means "the session died mid-request".

Recommended scope: **land the service-layer error shape + Finding 1 + Finding 3 together** (they are one change; Finding 3 is mechanical once the service throws a typed error), and **Finding 2 in the same change** because SSR is where the worst residual bug lives — the `/cars?error=load_failed` redirect target is itself unguarded (`cars.astro:16` has no try/catch), so the error path leads to a page that cannot survive the error.

---

## Detailed Findings

### Area 1 — What each caught exception can actually be

Findings marked **[probed]** were verified empirically against the running local stack (PostgREST + Postgres 17 at `127.0.0.1:54321`).

#### 1.1 supabase-js never rejects here — the only throw is the service's own

`PostgrestBuilder.then` (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:369-438`) catches _everything_ — fetch failure, DNS error, AbortError, a `JSON.parse` blowup on the response body — and converts it into a populated `res.error` with **`code: ""`**, `status: 0`. `.throwOnError()` is never called in this repo.

Two load-bearing consequences:

- **A network fault arrives as `res.error`, not an exception.** It fails the `res.error.code === "PGRST116"` test at `cars.ts:13` and becomes `throw new Error("TypeError: fetch failed")` — which is precisely what `.catch(() => null)` converts to `404 Not found`. Finding 1 now has a mechanism, not just a hypothesis.
- `(err as Error).message` is _type_-safe today (the value is always an `Error` the service constructed) but its _content_ is Postgres-authored — or, in six places, a raw JS runtime message (see 1.6/S4).

#### 1.2 RLS denial is asymmetric — reads are silent, writes are loud

| Operation                     | RLS denies    | Observable                                                                                                                                                 |
| ----------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SELECT                        | rows filtered | **`200 []`** — no error at all [probed: anon `GET /cars` → `[]`]                                                                                           |
| UPDATE / DELETE (USING fails) | row invisible | **0 rows affected** → with `.single()`: `406 PGRST116` [probed]; with bare `.delete()`: `204` [probed]; with `.delete().select("id")`: `200 []` [probed]   |
| INSERT (WITH CHECK fails)     | error         | **`42501`** `new row violates row-level security policy for table "cars"` — HTTP **401** when role is `anon` [probed], 403 when `authenticated` [inferred] |

`PGRST301` is a _JWT_ failure and is distinct from RLS [probed: `Bearer not.a.jwt` → `401 {"code":"PGRST301"}`]. **A denied SELECT never errors**, so there is no "RLS threw" case to handle on reads.

All twenty RLS policies are byte-identical in shape — `USING (auth.uid() = user_id)` / `WITH CHECK (auth.uid() = user_id)` (`supabase/migrations/20260527000000_cars_schema.sql:19-36`, `20260528000000_entries_schema.sql:15-32,52-69,90-107,129-146`). **No policy names a role** (no `TO authenticated`), so they apply to `PUBLIC` including `anon`; with `anon`, `auth.uid()` is NULL and every policy denies. Table GRANTs are full for both roles [probed], so `42501` can only ever come from RLS.

#### 1.3 The reachable code set [all probed]

| Code       | HTTP       | Trigger                                                                                 | Recommended class                         |
| ---------- | ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `22P02`    | 400        | `id=eq.abc` on a uuid column                                                            | **400** — client's malformed id           |
| `22008`    | 400        | `conducted_at: "2026-02-30"`                                                            | **400** — validator let it through        |
| `22003`    | 400        | `mileage: 99999999999`                                                                  | **400** — validator let it through        |
| `23502`    | 400        | `description: null` (`details` carries the **entire failing row incl. `user_id`**)      | **400** — latent, see S1                  |
| `23503`    | 409        | `car_id` absent from `cars`                                                             | **409 or 404** — car vanished mid-request |
| `42501`    | 401 (anon) | anon INSERT                                                                             | **401** — session died, not "forbidden"   |
| `PGRST116` | 406        | `.single()` over 0 rows **or N>1 rows**                                                 | see 1.5                                   |
| `PGRST204` | 400        | unknown key / stale schema cache                                                        | **500** — deploy skew                     |
| `PGRST301` | 401        | malformed / expired JWT                                                                 | **401**                                   |
| `57014`    | 500        | statement timeout (`anon` **3s**, `authenticated` **8s** [probed `pg_roles.rolconfig`]) | **503 or 500**                            |
| `""`       | status 0   | fetch/DNS/abort                                                                         | **503 or 500**                            |

**`23505` is unreachable.** [probed] `pg_constraint` over all five tables lists only primary keys and foreign keys — **zero UNIQUE, zero CHECK**. Every PK is `id UUID DEFAULT gen_random_uuid()` and no service supplies `id` on insert. `change.md`'s assumption list names "`23505` duplicate" as a genuine 4xx case; it cannot occur in this schema.

#### 1.4 The load-bearing answer on `getCarById`

**Foreign but well-formed uuid → returns `null`. It does not throw.** [probed] Two independent filters exclude the row — the explicit `.eq("user_id", userId)` at `cars.ts:11` _and_ the RLS `USING` clause. Zero rows → `406 PGRST116` → `cars.ts:13` returns `null`; `cars.ts:14` is never reached.

**Malformed id (`"abc"`) → throws.** [probed] `400 {"code":"22P02","message":"invalid input syntax for type uuid: \"abc\""}` → `cars.ts:14` throws. Where it lands differs at every call site:

| Call site                                                                | id validated?                                                                     | `"abc"` produces                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------- |
| `src/pages/api/cars/[id].ts:48`, `:91`                                   | no — only `if (!id)`                                                              | **`404 Not found`**                     |
| `src/pages/api/cars/[id]/select.ts:23`                                   | no                                                                                | **`404 Not found`**                     |
| `src/pages/api/ai/chat.ts:38`                                            | no — id is the `selected_car_id` **cookie** (`middleware.ts:21`), client-settable | **no try/catch** → uncaught → Astro 500 |
| `dashboard.astro:28`, `entries.astro:29`, `entries/[type]/[id].astro:40` | no — same cookie                                                                  | **redirect `/cars?error=load_failed`**  |
| all eight entry API routes                                               | **yes**, `z.uuid()` (`repair.ts:11` etc.)                                         | unreachable — zod 400 first             |

**`22P02` is reachable through three unvalidated doors and produces three different answers, none of them 400.** The cookie path matters: `selected_car_id` is client-settable regardless of `httpOnly`, so this is reachable without a malformed URL.

#### 1.5 `PGRST116`-only is right by accident; `.maybeSingle()` is strictly better

Three concrete problems with `cars.ts:12-15`:

1. **`PGRST116` does not mean "not found."** It means "not exactly one row" — [probed] a `.single()` over four rows returns the identical code with `"The result contains 4 rows"`. The mapping to `null` is safe _only_ because every `.single()` here filters on a primary key — a real but undocumented invariant, one `.eq("brand", …)` away from converting a duplicate-row bug into a 404.
2. **It is a string comparison against a client-synthesized value.** `PostgrestBuilder.ts:490-499` shows supabase-js manufacturing `PGRST116` itself for the `maybeSingle` >1 case.
3. **It is applied inconsistently.** Six functions map it to `null`; **`updateCar` (`cars.ts:25-29`) does not** — so "car doesn't exist" becomes a thrown fault and, at `[id].ts:68-69`, a **500 whose body is `"Cannot coerce the result to a single JSON object"`**. Unreachable today only because `[id].ts:48` pre-checks first; reorder or remove that pre-check and it ships.

**The codebase already contains the better model.** `getEntryById` (`entries.ts:145-152`) uses `.maybeSingle()`:

```ts
.eq("id", entryId).eq("user_id", userId).maybeSingle();
if (res.error) throw new Error(res.error.message);   // error channel = faults only
if (!res.data) return null;                          // absence channel = absence only
```

Converting `getCarById` and the four `update*Entry` functions to `.maybeSingle()` makes absence a **data** outcome, leaving the error channel containing nothing but faults — exactly the separation this change needs. The lost server-side "exactly one" assertion was never buying anything (every filter is on a PK); if wanted back, `>1` still surfaces as `PGRST116` under `maybeSingle` and is correctly a **500 invariant violation**.

#### 1.6 Surprises

- **S1 — the local DB is three migrations behind, hiding two whole error classes.** [probed] `schema_migrations` holds only `20260527000000` and `20260528000000`. Unapplied: `…001` (`CHECK (mileage > 0)` ×4), `…002` (`insurer NOT NULL`), `…003` (`result NOT NULL`). The zod schemas _contradict_ the intended schema — `inspection.ts:19-23` and `insurance.ts:19-22` allow `null`, and `src/types.ts:58,64` type them `| null`. Once those migrations land, every POST omitting `insurer`/`result` becomes `23502`, and `mileage: 0` (permitted by `z.number().int().min(0)`) becomes `23514`. **The decision table must cover `23502`/`23514` as 400s even though they cannot be reproduced locally today.**
- **S2 — two client-fault codes are reachable right now through validators that look strict.** `conducted_at`'s regex `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-02-30` → [probed] `22008`; `mileage` has no upper bound → `99999999999` → [probed] `22003`. Both currently return **500 with raw Postgres text**. Two `z` refinements turn two 500s into 400s — the cheapest wins in the change.
- **S3 — the failure-mode redirect target is itself unguarded.** Five SSR catches redirect to `/cars?error=load_failed`, but `cars.astro:16` calls `await getCars(supabase)` with **no try/catch at all**. Whatever fault bounced the user off the dashboard hits `getCars` on arrival and produces Astro's raw 500 page. **The error path leads to a page that cannot survive the error.**
- **S4 — `res.data` is dereferenced without a null guard in six places** (`entries.ts:264,274,284,294` `.length`; `:28,59,93,127` `.map`; `:345-347,419-430` `[0]`). `PostgrestBuilder.ts:522-527` has a path where `error === null && data === null`. If it fires, `(err as Error).message` puts `"Cannot read properties of null (reading 'length')"` in the HTTP response body. The unchecked cast `change.md` flags is real — just not for the stated reason.
- **S5 — `42501`'s HTTP status is role-dependent** [probed anon → **401**]. Because the anon downgrade at `SupabaseClient.ts:536-542` is silent, `42501` here almost always means the session died mid-request. **401 + re-auth is correct; not 403, not 500.**
- **S6 — `23502`'s `details` contains the entire failing row incl. `user_id`** [probed]. Nothing leaks today because services discard `.details` — but any "preserve the full error" fix must keep `.details` **out of the body and in the log**.
- **S7 — `getCars` (`cars.ts:4-8`) and `deleteCar` (`cars.ts:31-34`) omit the `user_id` filter** every other function carries, leaving RLS as sole defense. `deleteCar` additionally has no `.select()`, so PostgREST answers `204` with `error: null` even when zero rows matched [probed] — **the one operation in the codebase that can report success for a no-op.** Contrast `deleteRepairEntry` (`entries.ts:261-265`), which returns a boolean. `e2e/cross-user-data-isolation.spec.ts:17-22` already calls out `getCars`.

---

### Area 2 — The existing contract and who depends on it

#### 2.1 The de-facto envelope

The only written spec is `context/changes/car-management/plan.md:46`: `{ car }` / `{ cars }` on success, `{ error: string }` on failure, 200/201/400/401/404/500. It says nothing about what may appear _inside_ the error string. Success shapes were **deliberately** left non-uniform (`context/changes/entry-detail-actions/plan.md:49`): PATCH returns `{ entry }`, DELETE returns bare `204`, `select.ts:35` and `cars/[id].ts:103` return `{ success: true }`.

**There is no shared error helper of any kind** — no `src/lib/api-errors.ts`, no `jsonError()`, no `ApiError` in `src/types.ts`. All ~60 error returns are hand-rolled.

#### 2.2 The raw-leak inventory: 20 sites, not 14

16 in `src/pages/api/entries/*.ts` (4 per file × 4 files) and 4 in cars (`cars/index.ts:44,77`; `cars/[id].ts:69,105`).

#### 2.3 Which UI surfaces actually change

**14 DOM sites render `json.error` verbatim.** Would visibly change if bodies became generic:

| Surface                                                                                                                                                                                                                                                                              | Covers                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `CarList.tsx:124`                                                                                                                                                                                                                                                                    | `DELETE /api/cars/:id` 500                  |
| `CarForm.tsx:226`                                                                                                                                                                                                                                                                    | `POST /api/cars`, `PATCH /api/cars/:id` 500 |
| 8 entry-form paragraphs (`RepairEntryForm.tsx:128`, `RepairEntryEditForm.tsx:126`, `OilChangeEntryForm.tsx:103`, `OilChangeEntryEditForm.tsx:111`, `InspectionEntryForm.tsx:132`, `InspectionEntryEditForm.tsx:141`, `InsuranceEntryForm.tsx:150`, `InsuranceEntryEditForm.tsx:149`) | POST/PATCH 500s                             |
| `EntryDetailEditor.tsx:166`                                                                                                                                                                                                                                                          | `DELETE /api/entries/*` 500                 |

Already generic, **no change**: `StreamingText.tsx:16`, `ChatDemo.tsx:82`.

**5 of the 20 leak sites are UI-dead**: `GET /api/cars` 500 (`index.ts:44`) — its message is discarded by `CarList.tsx:70,80` — and all four `GET /api/entries/*` 500s, which **have no client at all** (entry lists are SSR-hydrated from `entries.astro:38-49`). Changing those five is invisible.

**Two clients lack the `res.json().catch(() => ({}))` guard** — `CarList.tsx:44` and `CarForm.tsx:87` — so a non-JSON body (Astro's HTML 500 page after an uncaught throw) throws into their outer catch. Any change that produces uncaught throws must keep those two in mind.

#### 2.4 i18n: the translated fallback is currently dead

Only two generic error keys exist (`src/i18n/locales/en.json:23-24`, `pl.json:23-24`): `common.networkError` and `common.anErrorOccurred` ("An error occurred" / "Wystąpił błąd"). There is **no vocabulary for "server error", "invalid input", "unauthorized", or a generic "not found"**.

Astro pages _do_ have a server-side equivalent — `getT(lang)` (`src/i18n/server.ts:17-19`), used in `dashboard.astro:11`, `entries.astro:15`, `cars.astro:9`, `[id].astro:14`. React islands use `useTranslation()` via `createClientI18n` (`src/i18n/client.ts:8-20`).

**The critical mechanic:** clients do `json.error ?? t("common.anErrorOccurred")` — the translated fallback only fires when the `error` field is **absent**. Since every route always sends _some_ `error` string, a Polish user sees English or raw Postgres text for **every** API-originated error today. Sending a generic English string keeps the fallback dead.

#### 2.5 SSR pages

`error=load_failed` is written in **5 places and read in zero** — confirmed: `grep -rn "load_failed" src/` returns only `dashboard.astro:33`, `entries.astro:31,48`, `[id].astro:29,44`. The only `searchParams` reads in `src/` are `signin.astro:8` and `signup.astro:8`. `cars.astro` never touches `Astro.url`.

**Two mechanisms already exist that a page could reuse:** `CarList` owns an `error` state rendered at `CarList.tsx:124` and takes props from the page (an `initialError` prop is a one-liner); and `src/components/Banner.astro` is a ready-made `variant="error"` with `role="alert"`, currently mounted only for config warnings (`Layout.astro:22-37`). There is no toast system.

**Additional unguarded sites the audit's `catch`-grep could not see** (they contain no `catch`): `cars.astro:16` (`getCars`), `ai-chat.astro:21` (`getCarById`), `chat.ts:38` (`getCarById`).

#### 2.6 A fourth leak class the audit missed

`src/pages/api/auth/signin.ts:16` and `signup.ts:16` do `redirect("/auth/signin?error=" + encodeURIComponent(error.message))` — **raw Supabase auth messages into the query string**, rendered by `src/components/auth/ServerError.tsx:11`. Same defect class as Finding 3, different subsystem. Neither route uses zod; `form.get("email") as string` is unchecked (`signin.ts:6-7`).

#### 2.7 No global mechanism exists

`src/middleware.ts` (35 lines) has no try/catch and no logging. No `404.astro` / `500.astro`. No React error boundary (`grep -rn "ErrorBoundary\|componentDidCatch\|onError" src/` → nothing). Layouts have no error slot.

---

### Area 3 — The house pattern, prior decisions, and what tests lock in

#### 3.1 The pattern, verbatim (`src/pages/api/ai/chat.ts:43-50`)

```ts
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[ai/chat] Service error:", err);
  return Response.json({ error: "AI service error" }, { status: 500 });
}
```

Two halves, deliberately split: **operator gets the raw object; client gets a fixed literal.** The streaming variant (`:54-73`) differs in three ways — status is already committed, so the error travels as an in-band SSE frame; it always emits a terminating `data: [DONE]`; and it is the only `finally` in the file.

**Verdict: the split is exactly right and is the only place in the codebase that gets it right.** But it is thin, and lacks four things a general rule needs: bare-string (unqueryable) logging, **zero request context** (no user id, route, method, or correlation id — given a production line you can identify which of two catch blocks fired and nothing else), no shared helper (copy-paste drift across 20 sites), and a per-site `eslint-disable` that quietly discourages the pattern it establishes.

#### 3.2 Prior decisions

| #      | Decision                                                                                                                                                                                                                                                            | Source                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **D1** | **Generic 500 body + server log, because raw SDK errors leak upstream detail.** Reviewer rejected `(err as Error).message` as a body; fixed in `50833b5`. **This is where the house pattern came from — and the construct it rejected survives at 20 other sites.** | `context/changes/ai-car-chat/reviews/impl-review.md:80-88`             |
| **D2** | **Server-side logging is mandatory because a silent catch is invisible in `wrangler tail`.**                                                                                                                                                                        | `context/changes/ai-integration-scaffold/reviews/impl-review.md:83-88` |
| **D3** | **404, not 403, for a resource the caller does not own** — anti-enumeration. Applied at `chat.ts:38-41`.                                                                                                                                                            | `context/changes/ai-car-chat/reviews/impl-review.md:23-31`             |
| **D4** | The JSON envelope was fixed once, early, never revisited.                                                                                                                                                                                                           | `context/changes/car-management/plan.md:46`                            |
| **D5** | Uniformity of the _success_ envelope was explicitly rejected.                                                                                                                                                                                                       | `context/changes/entry-detail-actions/plan.md:49`                      |
| **D6** | **`null` from a service means 404 at the route**; the service's `.eq` + `PGRST116 → null` _is_ the ownership check. **This is the assumption Finding 1 attacks** — sound only while the `null` and throw paths stay distinguishable.                                | `context/changes/entry-management/plan.md:23,30,52`                    |
| **D7** | **"Absence of an error is not evidence of success" has already bitten this repo once** — a zero-row DELETE returned 204; fixed by adding `.select("id")` and a boolean return. Directly relevant to S7's `deleteCar`.                                               | `context/changes/entry-management/reviews/impl-review.md:29-30`        |
| **D8** | **R2's line: secrets in _server logs_ are in-policy; secrets in _response bodies_ are not.**                                                                                                                                                                        | `context/changes/testing-bootstrap-ai-chat/research.md:211,39,348-349` |
| **D9** | Phase 1 **pinned** the chat route, explicitly refusing to refactor it — so the pattern was never _promoted_ to a house rule.                                                                                                                                        | `context/changes/testing-bootstrap-ai-chat/plan.md:86`                 |

**⚠️ D3 is contradicted in code.** Entry POST returns **`403 "Forbidden"`** for a foreign `car_id` (`inspection.ts:86` and siblings), while the plan that introduced it says 404 (`context/changes/additional-entry-types/plan.md:14,97`), and that same plan contradicts itself — `:152` says "wrong `car_id` returns 404", `:406` says "returns 403". **The 403/404 convention is genuinely unsettled and planning must pick one.**

`context/archive/` contains only `README.md` — no archived changes, no further history.

#### 3.3 What the tests lock in

**Unit specs break on nothing.** `src/test/lib/services/ai.test.ts` and `ai-config.test.ts` assert prompt content and a thrown service message; neither touches an API envelope.

**`src/test/pages/api/ai/chat.test.ts` — eight `toEqual({ error: "…" })` assertions** at lines **91, 98, 105, 112, 119, 128, 138, 163**. `toEqual` is exact-shape: **adding any field (`code`, `requestId`) or nesting under `{error: {message}}` breaks all eight.** Survives any envelope change: the two "secret not leaked" assertions (`:165`, `:183`), the "dependency not called" guard (`:140`), and both SSE `toContain` assertions.

**No test anywhere asserts `console.error` was called** — no `vi.spyOn(console, …)` in the repo, and `context/foundation/test-plan.md:225-228` makes that an explicit decision. **So adding logging breaks nothing and is verified by nothing.**

**Harness shape — cheap to extend.** Routes are invoked directly with a hand-built context, no HTTP server (`chat.test.ts:16,46-56`). `makeContext` is local to that one file; the reusable recipe is written up at `test-plan.md:192-231`. Cost of extension: entries routes read `locals.user` exactly like chat, so `makeContext` transfers as-is; `cars/*` routes self-auth via `supabase.auth.getUser()` and need one extra mock layer.

**E2E: changing error _bodies_ breaks nothing** — no spec reads an error body; the only body read is `{ car: { id } }` on a 201. **Adding 500s breaks exactly one assertion:** `e2e/cross-user-data-isolation.spec.ts:99` requires a genuine `404` for a foreign entry id. That is correct behavior for the test, and the reason `change.md`'s `z.uuid()` prescription matters. `:100` pins the translated heading `"Entry not found"` (a page string, not an envelope).

**E2E auth has a live redundancy:** `playwright.config.ts:38-41` seeds a shared cached session via `e2e/auth.setup.ts`, but `e2e/fixtures/app.ts:64` sets `storageState: {cookies: [], origins: []}` — all three specs use `signedInPage` and create throwaway per-test users (`app.ts:161-217`), so **the cached session is currently used by nothing.**

#### 3.4 Test-plan positioning

R2 verbatim (`test-plan.md:50`): _"**OpenRouter API key / secrets leak** into logs, error response bodies, or the client bundle"_ — High/Medium. R3 (`:51`): _"**Cross-user data access (IDOR)** — a user reads, edits, or deletes another user's car or entry by id"_ — High/High, guidance `:84` names the anti-pattern _"testing only the owner's happy path; trusting RLS without exercising a second user"_.

Finding 3 sits squarely inside R2's literal text. **R5 is also implicated** (`:53,86`): server-side validation must be _"enforced independent of the client"_, with the anti-pattern _"over-mocking the DB so constraints never fire"_ — **any change that converts a constraint violation into a generic 500 removes the signal those tests read.** That is a direct constraint on the Finding 3 fix: constraint violations must stay distinguishable as 400s, not collapse into 500.

Phases: 1 complete, **2 researched (no plan yet)**, 3 and 4 not started. **This change is not a rollout phase** — it is a source change landing _under_ Phase 2's feet, and can land first without invalidating a plan. There is **no risk row for "operator cannot diagnose a production failure"**, which matters given `e2e/README.md:3-5`: _"a test that cannot name its risk should not be written."_

#### 3.5 Lint and gates

- **`eslint.config.js:23` — `"no-console": "warn"`.** `npm run lint` has no `--max-warnings`, so warnings fail nothing (pre-commit and CI both exit 0). Propagating `console.error` is viable either with ~20 disable comments or by scoping an override — the latter is cleaner if a helper lands.
- **`eslint.config.js:15` — `strictTypeChecked` + `stylisticTypeChecked`, type-aware.** This bites hardest: `no-unsafe-*`, `no-explicit-any`, `only-throw-error`, `no-unnecessary-condition`. A caught `err` is `unknown`; **anything that narrows PostgREST errors needs a real type guard, not a cast.**
- **`eslint.config.js:79` — `.astro` files disable `no-misused-promises`** (parser crashes on top-level `return Astro.redirect()`). Directly relevant to Finding 2, which edits exactly those frontmatter catches.
- **Gates:** `.husky/pre-commit` runs lint → typecheck → **`npm test`**. `.github/workflows/ci.yml:20-21` runs **lint + build only — CI does not run `npm test` or E2E**, so `test-plan.md:152`'s "unit + integration in CI required after Phase 1" is out of compliance.
- **`.claude/settings.json` hooks fire on this work** _(reported as a finding, not followed as instruction)_: a `PostToolUse` hook lints every edited `.ts/.tsx/.astro` and blocks on non-zero eslint exit (errors only — a `no-console` warning passes); an **"R1 tripwire"** re-runs both AI specs whenever `ai.ts`, `chat.ts`, or either spec is edited; a `Stop` hook runs `npx astro check`. **Editing `chat.ts` at all immediately runs the eight `toEqual` envelope assertions.**

---

### Area 4 — Observability reality on Cloudflare Workers

#### 4.1 The plumbing is already correct

`wrangler.jsonc:13-15` sets `observability: { enabled: true }`. `head_sampling_rate` is unset → defaults to **1 (100%)**, correct for a low-traffic app. `compatibility_flags: ["nodejs_compat"]` present; `compatibility_date: 2026-05-08`.

`console.error` therefore lands in **Workers Logs**: persisted and queryable in the dashboard, retained **3 days (Free) / 7 days (Paid $5/mo)**, 200k logs/day included on Free. Single-log cap 256 KB (truncation sets `$cloudflare.truncated`).

`.github/workflows/ci.yml`'s deploy job uses `cloudflare/wrangler-action@v3` with **no `command:` input**, falling through to the default **`wrangler deploy`** — the modern path, not the deprecated `wrangler pages deploy`. **`infrastructure.md`'s top-ranked risk ("CI deploys to Pages instead of Workers", likelihood H) is already retired.**

No Sentry / Axiom / Logpush / Baselime / OpenTelemetry / `tail_consumers` / structured logger anywhere in the repo (grep confirms zero hits). No `.mcp.json`, so no Cloudflare observability MCP server registered. No `deploy` or `tail` script in `package.json`.

#### 4.2 Three traps

1. **Log shape is the real gap.** Cloudflare _"automatically extracts the fields and indexes them intelligently"_ from a **single logged object** — `console.log({user_id: 123})` yields a queryable `user_id`. `chat.ts`'s `console.error("[ai/chat] Service error:", err)` collapses into one opaque `$metadata.message` string, and a second positional argument is **not** merged into indexed fields. Copying that shape 20× produces 20 unqueryable blobs.
2. **Caught errors never appear in the Errors tab.** `$workers.outcome = "exception"` and `$metadata.error EXISTS` match only _uncaught_ throws. Twenty well-behaved catch blocks are invisible there **by construction** — if someone later says "check the Errors tab", they will see zero and conclude the app is healthy.
3. **`Astro.locals.runtime` was removed in `@astrojs/cloudflare` v13 / Astro 6.** The ExecutionContext is now `Astro.locals.cfContext` (verified in the installed package: `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:2`). `src/env.d.ts` declares only `user`, `selectedCarId`, `lang` — so `locals.cfContext` is a type error today. **Any plan written against `locals.runtime.ctx.waitUntil` will fail typecheck.** It is not needed anyway: a synchronous `console.error` before `return` is flushed (the "dropped logs" warning concerns _unawaited async work that would later log_).

#### 4.3 `wrangler tail` is not the observability story

Live-only, no history (_"Real-time logs does not store Workers Logs"_); enters sampling mode under load and drops messages; max 10 concurrent viewers. It is a debugging tool. Workers Logs is the retention story, and it is already on.

#### 4.4 Verdict

Deploy as configured today and the lines are visible to anyone with dashboard access to the `car-booklet` Worker, for 3 days (Free) / 7 days (Paid). It is **pull-only** — no alerting; someone must go look. Nothing is silently dropped by config.

**Minimal recommendation:** (a) no config change needed — optionally upgrade to Paid for 7-day retention if debugging user-reported bugs is a real workflow, since 3 days rarely survives a weekend. (b) **Log one object, not a string + an error:**

```ts
console.error({
  event: "api_error",
  route: "/api/entries/repair",
  op: "createRepairEntry",
  userId: context.locals.user?.id,
  status: 500,
  code: /* PostgREST code, once the service preserves it */,
  message: err instanceof Error ? err.message : String(err),
});
```

`event = "api_error"` then returns every failure across all sites in one query, and `group by route` says which endpoint is broken. Never put a raw `Error` in a field — it does not JSON-serialize `message`/`stack`. Per **S6**, keep `res.error.details` in the log and out of the body. (c) Change `eslint.config.js:23` to `"no-console": ["warn", { "allow": ["error"] }]` rather than scattering 20 disable comments.

**Reject in planning:** any use of `Astro.locals.runtime`; any claim `ctx.waitUntil()` is needed to flush `console.error`; Logpush and Tail Workers as MVP scope (both require Workers Paid and neither adds anything Workers Logs does not already provide at this traffic).

---

## The per-boundary decision table

This is what `change.md` asked research to return. **Prerequisite for all of it:** the service layer stops flattening (see "Service-layer contract" below).

### Layer 0 — Service layer (the root fix)

| Function group                                                                                              | Change                                                                                                                          | Rationale                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `getCarById` (`cars.ts:10-17`), `update{Repair,OilChange,Inspection,Insurance}Entry` (`entries.ts:183-257`) | `.single()` → `.maybeSingle()`; `if (res.error) throw`; `if (!res.data) return null`                                            | Absence becomes a data outcome; the error channel then contains only faults (1.5)                                    |
| `updateCar` (`cars.ts:25-29`)                                                                               | same, **plus** add the missing `.eq("user_id", userId)`                                                                         | Today "no such car" is a thrown fault whose message is `"Cannot coerce the result to a single JSON object"` (1.5 #3) |
| **All 24 throw sites**                                                                                      | `throw new Error(res.error.message)` → a typed error preserving `code`, `message`, and PostgREST `status` (e.g. `ServiceError`) | The single load-bearing change. Routes cannot map anything while `.code` is destroyed (Summary #1)                   |
| `deleteCar` (`cars.ts:31-34`)                                                                               | add `.eq("user_id", userId)` and `.select("id")`, return boolean                                                                | S7 + precedent **D7** — currently reports success for a no-op                                                        |
| `entries.ts` `res.data` derefs ×6                                                                           | guard before `.length` / `.map` / `[0]`                                                                                         | S4 — otherwise a JS `TypeError` message ships in the response body                                                   |

**The split belongs in the service for _absence_, in the route for _status mapping_.** The service knows whether a row exists; only the route knows what HTTP means for its verb. Keep `null` as the absence signal (preserving **D6**) and let the route own `code → status`.

### Layer 1 — Code → status → body → log

| Code                                    | Status           | Body the client may see   | Log                                                                            |
| --------------------------------------- | ---------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `22P02` malformed uuid                  | **400**          | generic "Invalid request" | yes, with the offending param name (never the value from a cookie unvalidated) |
| `22008` bad date, `22003` numeric range | **400**          | generic "Invalid request" | yes — **also tighten the zod schema** (S2)                                     |
| `23502` not-null, `23514` check         | **400**          | generic "Invalid request" | yes; **`details` to the log only** (S6)                                        |
| `23503` FK violation                    | **409** (or 404) | generic                   | yes — the car vanished mid-request                                             |
| `42501` RLS insert denial               | **401**          | generic "Unauthorized"    | yes — session died (S5); **not 403**                                           |
| `PGRST301` JWT failure                  | **401**          | generic "Unauthorized"    | yes                                                                            |
| `PGRST116` under `maybeSingle` (>1 row) | **500**          | generic                   | yes — invariant violation                                                      |
| `PGRST204` schema cache                 | **500**          | generic                   | yes — deploy skew                                                              |
| `57014` timeout, `""` transport         | **503**          | generic                   | yes                                                                            |
| anything else                           | **500**          | generic                   | yes                                                                            |

### Layer 2 — Per-site dispositions

| Sites                                                                                 | Today                                             | Should be                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cars/[id].ts:48`, `:91`, `cars/[id]/select.ts:23` — **Finding 1**                    | `.catch(() => null)` → 404 for every fault        | `try/catch` → log + mapped status; `if (!car)` → 404. **Add `z.uuid()` on the path param** so `22P02` stays 4xx                                          |
| `cars/index.ts:44` + 4× entries `GET` catch                                           | raw 500                                           | log + generic 500. **UI-invisible** (2.3) — safest sites to land first                                                                                   |
| `cars/index.ts:77`, `cars/[id].ts:69`, `:105`, 12× entries POST/PATCH/DELETE catch    | raw 500 → **rendered in the DOM**                 | log + mapped status + generic body. This is the user-visible half of Finding 3                                                                           |
| 5× JSON-parse `} catch {` (`cars/index.ts:64`, `repair.ts:57`, `oil-change.ts:61`, …) | `400 {"error":"Invalid JSON"}`                    | **already correct** — leave alone                                                                                                                        |
| 5× SSR catch → `/cars?error=load_failed` — **Finding 2**                              | silent redirect, nothing logged, param never read | log + surface it. Either an `initialError` prop into `CarList` (`CarList.tsx:124` already renders it) or `Banner.astro` (`Layout.astro:22-37` precedent) |
| `cars.astro:16`, `ai-chat.astro:21`, `chat.ts:38`                                     | **no handler at all**                             | **S3 is the priority**: `cars.astro` is the redirect _target_, so the error path currently leads to a page that cannot survive the error                 |
| `auth/signin.ts:16`, `signup.ts:16`                                                   | raw Supabase auth message into the query string   | same defect class, different subsystem (2.6). Planning's call whether it rides along                                                                     |

### Layer 3 — Body shape

Two viable options; they differ on whether Polish users get Polish errors.

- **Option A (recommended for this change): keep `{ error: "<generic English literal>" }`.** Matches **D1**/`chat.ts` precedent exactly, keeps all eight `toEqual` assertions alive, **requires zero client edits**, and breaks no E2E assertion. Translation stays broken — but it is broken today and fixing it is a separate concern.
- **Option B: omit the `error` field on 500s** (`Response.json({}, { status: 500 })`). Because every client does `json.error ?? t("common.anErrorOccurred")`, the **translated fallback fires automatically** — 14 DOM sites become bilingual with zero client edits and zero new i18n keys. Cheapest possible path to translated errors, but it signals via a _missing_ field, and `CarList.tsx:44` / `CarForm.tsx:87` do unguarded `res.json()` so the body must remain valid JSON.

**Do not add a `code` field to the envelope** without budgeting for the eight `toEqual` breaks in `chat.test.ts` (3.3).

---

## Code References

- `src/lib/services/cars.ts:6,14,21,27,33` — the five flattening throw sites; `:10-17` the `PGRST116` special case; `:4-8`, `:31-34` the two functions missing the `user_id` filter
- `src/lib/services/entries.ts:145-152` — `getEntryById`, the model implementation; `:196,215,234,253` the four `PGRST116 → null` sites; `:264,274,284,294` unguarded `res.data.length`
- `src/pages/api/cars/[id].ts:48,91` and `src/pages/api/cars/[id]/select.ts:23` — Finding 1's three swallows
- `src/pages/api/cars/index.ts:44,77`; `src/pages/api/cars/[id].ts:69,105`; 16 sites across `src/pages/api/entries/{repair,oil-change,inspection,insurance}.ts` — Finding 3's 20 raw echoes
- `src/pages/api/ai/chat.ts:43-50,54-73` — the house pattern
- `src/pages/dashboard.astro:26-34`; `src/pages/entries.astro:28-32,39-49`; `src/pages/entries/[type]/[id].astro:26-30,39-45` — Finding 2's five SSR swallows
- `src/pages/cars.astro:16`, `src/pages/ai-chat.astro:21` — unguarded service calls the `catch`-grep could not see
- `src/pages/api/auth/signin.ts:16`, `signup.ts:16` — the fourth leak class
- `src/components/cars/CarList.tsx:124`, `CarForm.tsx:226`, `EntryDetailEditor.tsx:166` + 8 entry-form paragraphs — the 14 DOM sites rendering `json.error`
- `src/i18n/locales/en.json:23-24`, `pl.json:23-24` — the only two generic error keys
- `src/test/pages/api/ai/chat.test.ts:91,98,105,112,119,128,138,163` — the eight exact-shape envelope assertions
- `e2e/cross-user-data-isolation.spec.ts:99` — the one E2E assertion a careless 500-split breaks
- `wrangler.jsonc:13-15` — `observability.enabled: true`
- `eslint.config.js:15,23,79` — `strictTypeChecked`, `no-console: warn`, the `.astro` promise-rule exemption
- `supabase/migrations/20260527000000_cars_schema.sql:19-36` — the RLS shape repeated 20×

## Architecture Insights

- **One root cause, three symptoms.** Findings 1, 2 and 3 are downstream of a single service-layer decision to flatten `res.error` into `new Error(message)`. Treating them as three separate fixes means writing the same missing information three times.
- **Absence and fault must travel in different channels.** The codebase already contains both the wrong shape (`.single()` + `PGRST116` string match) and the right one (`.maybeSingle()` + `!res.data`). This is a convergence, not a redesign.
- **The reviews are the real rules file.** `CLAUDE.md` says nothing about error handling, status codes, or logging. Every convention that exists — generic bodies (D1), mandatory logging (D2), 404-not-403 (D3), affected-row checks (D7) — was established in an impl-review and then partially forgotten. **D1 and D7 have each already been re-litigated in code.** `context/foundation/lessons.md` does not exist; `/10x-lesson` would be the right home for D1/D3/D7.
- **A 404 that means four things is a broken oracle.** Because `getCarById` answers absence with `null` and faults with a throw, and the route collapses both, an R3 isolation test asserting 404 passes when isolation works _and_ when the database is unreachable. `change.md`'s framing of this is exactly right.
- **`local dev == workerd` cuts both ways.** `astro dev` runs on workerd (adapter v13), so logging behaves the same locally and deployed — but `locals.runtime` is gone and `App.Locals` would need widening for anything reaching the ExecutionContext.

## Historical Context (from prior changes)

- `context/changes/ai-car-chat/reviews/impl-review.md:80-88` — **D1**, the origin of the generic-500 pattern, rejecting the exact construct Finding 3 documents
- `context/changes/ai-car-chat/reviews/impl-review.md:23-31` — **D3**, 404-not-403 for anti-enumeration; contradicted by `additional-entry-types/plan.md:14,97,152,406` and by the 403 in `inspection.ts:86`
- `context/changes/ai-integration-scaffold/reviews/impl-review.md:83-88` — **D2**, logging mandated because a silent catch is invisible in `wrangler tail`
- `context/changes/entry-management/plan.md:23,30,52` — **D6**, "a null return from the service means 404", the assumption Finding 1 attacks
- `context/changes/entry-management/reviews/impl-review.md:29-30` — **D7**, the zero-row-DELETE bug; the precedent for S7
- `context/changes/testing-bootstrap-ai-chat/research.md:211` — **D8**, R2's line between server logs and response bodies
- `context/changes/car-management/plan.md:46` — **D4**, the only written envelope spec in the project
- `context/foundation/infrastructure.md` — pre-dates the repo config; its highest-likelihood risk (CI deploying to Pages) is retired by `ci.yml`'s actual `wrangler deploy`

## Related Research

- `context/changes/data-isolation-crud-integrity/research.md` — Phase 2 (R3/R5). Researched, **no plan yet**, so this change can land underneath it without invalidating anything. Notes that `api/cars/*` self-auth via `supabase.auth.getUser()` while `api/entries/*` trust `locals.user`
- `context/changes/testing-bootstrap-ai-chat/` — Phase 1; produced both the pattern and the test harness recipe (`test-plan.md:192-231`)
- `context/foundation/test-plan.md:50-51,83-84,86` — R2, R3 and R5 verbatim

## Open Questions

1. **403 or 404 for a foreign `car_id` on entry POST?** The repo currently does both, and the plan that introduced it contradicts itself. **Planning must pick one and write it down** — this is the clearest `/10x-lesson` candidate in the change.
2. **Option A or B for the response body** (generic English vs omit-and-let-`t()`-fire). B is the only cheap route to translated errors; A is the one with precedent.
3. **`23503` → 409 or 404?** It means "the car was deleted between the ownership pre-check and the insert". 409 is honest; 404 is consistent with D3's anti-enumeration stance.
4. **Do the three unapplied migrations land in this change or separately?** They activate `23502`/`23514` (S1) and expose the zod-vs-schema contradiction on `insurer`/`result`. Fixing error mapping _without_ tightening zod means a well-formed 400 for what is still a validator bug.
5. **Do `auth/signin.ts:16` and `signup.ts:16` ride along?** Same defect class, different subsystem, no test coverage either way.
6. **Should CI run `npm test`?** `test-plan.md:152` says it is required post-Phase-1; `ci.yml:20-21` runs lint + build only. Not this change's job, but this change adds the first tests that would benefit.
7. **Does anything alert?** Workers Logs is pull-only. There is **no test-plan risk row for "operator cannot diagnose a production failure"**, and per `e2e/README.md:3-5` a test that cannot name its risk should not be written — so the logging half of this change ships without a test, deliberately.
8. **Security, unrelated but urgent:** `git remote -v` exposes a plaintext GitHub PAT in `.git/config` (`https://ghp_…@github.com/…`). Rotate it and switch to SSH or a credential helper. This blocked GitHub permalink generation for this document.
