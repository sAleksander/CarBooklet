---
change_id: pre-demo-fixes
title: Pre-demo hardening — CI test gate, auth error reflection, streaming a11y, config hygiene
status: implemented
created: 2026-09-07
updated: 2026-09-10
archived_at: null
---

## Notes

Seeded from a full app-state audit run on 2026-09-07 (three parallel research
agents + a live end-to-end smoke test against local Supabase and `astro dev`).
The audit's conclusion was that the app is **feature-complete and demo-ready**;
this change collects only the loose ends the audit surfaced, with the user's
triage decisions already applied.

Everything below is decided. `/10x-research` and `/10x-plan` should treat the
IN SCOPE list as the work and the OUT OF SCOPE list as closed questions — do not
re-litigate them.

---

### Audit baseline (verified 2026-09-07, all green)

| Check                               | Result                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                      | 0 errors, 0 warnings                                                                                                                                                                                                                 |
| `npm run typecheck` (`astro check`) | 0 errors, 0 warnings, 248 files                                                                                                                                                                                                      |
| `npm test` (unit + client)          | 419 tests / 15 files, all pass                                                                                                                                                                                                       |
| `npm run build`                     | clean (one benign `@astrojs/sitemap` warning — see item 4)                                                                                                                                                                           |
| i18n EN/PL parity                   | 191/191 keys; the 2 extra PL keys are `_few`/`_many` plural forms — correct                                                                                                                                                          |
| RLS                                 | all 7 tables, all 4 operations, `TO authenticated`; parent-ownership closed on entries                                                                                                                                               |
| Live smoke test                     | signup → car → all 4 entry types → dashboard → entry detail → AI chat (SSE, correctly grounded on the just-logged entries) → thread persistence → 404 on foreign thread → delete → signout. All pass. Test users deleted afterwards. |
| Prod worker                         | `https://car-booklet.carbooklet.workers.dev` responds 200, no missing-config banner, `/dashboard` correctly 302s to `/auth/signin`                                                                                                   |

Feature scope vs `context/foundation/prd.md` and `prd-v2.md`: nothing missing.
The app over-delivered — inspections/insurance tabs, AI chat history, and
light/dark theming were parked or unplanned and shipped anyway.

---

## IN SCOPE

### 1. CI runs no tests — the real fix

**Finding.** `.github/workflows/ci.yml` runs `npm ci` → `npx astro sync` →
`npm run lint` → `npm run lint:colors` → `npm run build`. That is the whole `ci`
job. Three test suites exist and none are gated:

- `npm test` — 419 unit + client tests, zero external prerequisites (node + jsdom, `astro:env/server` is mocked at `src/test/__mocks__/astro-env-server.ts`). Should be trivially addable.
- `npm run test:integration` — 6 files under `integration/`, needs Docker + `npx supabase start` + `SUPABASE_URL` (hard-refuses anything that is not localhost), `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Needs a Supabase service container or the `supabase` CLI action in the workflow.
- `npm run test:e2e` — Playwright, chromium, 3 specs; `webServer` boots `npm run dev` itself; needs the same local Supabase + service-role key + `npx playwright install`.

`npm run typecheck` (`astro check`) is **also** missing from CI, despite in-code
comments noting that eslint and `astro check` disagree in places
(`src/lib/services/ai.ts`, around the `OpenAIAPIError` type). Type regressions
can merge today.

`context/foundation/test-plan.md` §5 declares unit + integration "required after
Phase 1" — so CI is out of compliance with the project's own written gate.

**Decision.** Fix properly. Planner should decide the staging (likely: typecheck

- `npm test` first as a cheap always-on gate, then integration behind a Supabase
  service, then e2e — possibly as a separate job or workflow so a slow browser run
  does not block every push).

**Open for the planner:** whether integration and e2e go in the same workflow or
a separate one; whether e2e runs on PR or only on `main`.

---

### 2. Auth error reflection (security) — small fix

**Finding.** `src/pages/api/auth/signin.ts:16` and
`src/pages/api/auth/signup.ts:16` both do:

```ts
return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
```

The raw Supabase `error.message` round-trips through the query string and is
rendered by `ServerError` (`src/components/auth/ServerError.tsx:13`) via
`src/pages/auth/signin.astro:9` → `SignInForm serverError={error}`.

Two problems:

1. **Attacker-controlled text on your own origin.** Not XSS — React escapes it — but anyone can craft `/auth/signin?error=<any sentence>` and the app renders it inside a styled, official-looking alert box. That is a phishing surface on the real domain.
2. **User enumeration.** Supabase distinguishes "Invalid login credentials" from other conditions; reflecting verbatim leaks which.

Neither route logs the failure either.

**Sizing (checked).** Small. Both route files are ~20 lines. The shape is: map
`error` to a small closed set of codes, redirect with `?error=<code>`, have the
page resolve the code to an i18n string (the app already has full EN/PL
infrastructure at `src/i18n/`), and ignore any `?error=` value not in the set.
Add a log line via the existing `api-errors` logging path. Roughly two route
files + one mapper + a couple of `en.json`/`pl.json` keys.

**Note.** This is item **F8** from
`context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md`
— carried over from an already-archived change and still present.

**Bonus, same file, decide in planning:** item **F10** from that same follow-up —
the five client-facing error literals in `src/lib/api-errors.ts:30-34` are still
English while the rest of the app is localized. Cheap to fold in if the planner
wants; not required.

---

### 3. Streaming reply has no accessible progress signal — small fix, do it

**Finding.** `src/components/ai/StreamingText.tsx` renders the in-flight answer
with a blinking `▋` caret and no `role`, no `aria-live`, no accessible name. A
screen-reader user gets zero signal that a reply is arriving. This directly
weakens the PRD v1 NFR "continuous AI query feedback".

It is also the documented reason the R6 E2E spec was never written —
`e2e/README.md:72-86` records that the only accessible progress signal today is
the composer's "Stop" button label.

**Sizing (checked).** Small. `StreamingText.tsx` is 35 lines.

**Design caution for the planner.** Do **not** put `aria-live` directly on the
markdown container — it re-parses on every token delta, so a live region there
would spam the screen reader with hundreds of interruptions per reply. The right
shape is a separate visually-hidden `role="status" aria-live="polite"` region
that announces _state transitions only_ ("Assistant is replying…" → "Reply
complete"), plus `aria-busy={active}` on the text container. Needs 2 new keys in
`src/i18n/locales/en.json` and `pl.json` under `aiChat.`.

Note `ChatThread.tsx:92` already uses `role="status"` for the error line — follow
that precedent.

**Secondary benefit.** Landing this unblocks the R6 Playwright spec that
`context/foundation/test-plan.md` Phase 4 charters but that was never written.
Whether to also write that spec is a planner call — it hits the real OpenRouter
model, which is non-deterministic and burns free-tier quota (see item 6 below).

---

### 4. Config hygiene — fix

Three small, unrelated items grouped because they are all one-liners:

- **`.env` has `ClOUDFLARE_API_TOKEN`** — lowercase `L` in "Cloudflare". Wrangler reads `CLOUDFLARE_API_TOKEN`, so the token is silently ignored and wrangler falls back to interactive OAuth. (Confirmed during the audit: `wrangler secret list` only worked after re-exporting the value under the correct name.) `.env` is gitignored, so this is a local-machine fix plus a check that `.env.example` spells it correctly.
- **`astro.config.mjs` has no `site`** — so `@astrojs/sitemap` skips on every build with `[WARN] The Sitemap integration requires the 'site' astro.config option.` Either set `site` to the workers.dev URL or drop the integration.
- **`package.json` name is still `10x-astro-starter`** — cosmetic; already noted in `context/deployment/deploy-plan.md` Appendix B and never actioned.

---

### 5. Thread-delete manual re-verification — note only, no code

**Finding.** The conversation-delete flow was rewritten by **F7** of the
ai-chat-history review (per-row React islands → one delegated dialog:
`src/components/ai/DeleteConversationDialog.tsx` +
`src/components/ai/ConversationList.astro`). The last manual sign-off (plan item
4.10) predates that rewrite, and no automated test reaches the `/ai-chat` thread
list. The audit exercised `DELETE /api/ai/conversations/[id]` directly (200 OK)
but not the UI.

**Decision.** The user recalls this being tested and working. Do **not** treat it
as a bug. Add a short manual-verification note — a Manual row in the plan's
Progress table, or a line in the demo checklist — to click through the delete
flow in a browser once before demoing. No code change.

---

## OUT OF SCOPE — decided, do not re-open

| #   | Item                                                                                                                                                                                                                                                                                                                                                       | Decision                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | **`OPENROUTER_API_KEY` not set on the production Worker** (`wrangler secret list` returns only `SUPABASE_KEY`, `SUPABASE_URL`; also absent from `ci.yml`'s `wrangler-action` secrets block). AI chat on the deployed URL persists the question then returns `500 {"error":"AI service error"}`.                                                            | **Intentional.** This is a proof-of-concept; there is no staging/production split and the demo runs locally where `.dev.vars` supplies the key. Not a bug. **Do not** add the secret, and **do not** add it to `ci.yml`. |
| B   | **Dashboard shows deadlines for the single cookie-selected car only**, not all cars — PRD v1 FR-012 says "for each car". `src/pages/dashboard.astro:15-17` redirects to `/cars` when nothing is selected.                                                                                                                                                  | **Intentional, leave as is.** Demo narration should say "my selected car", not "all my cars".                                                                                                                            |
| C   | **Cloudflare free-plan 10ms CPU cap.** `context/deployment/deploy-plan.md:303` calls upgrading to Paid "REQUIRED before real user traffic"; no record it happened. Risk of intermittent 503s on SSR + auth + React.                                                                                                                                        | **Accepted.** PoC traffic levels.                                                                                                                                                                                        |
| D   | **OpenRouter free tier: 50 requests/day; model is `openrouter/free`**, a router alias rather than a pinned model (`src/lib/services/ai.ts:171`), so turn 3 can be answered by a different model than turn 2 (persona whiplash). 429 surfaces as "AI assistant is rate-limited" (`src/pages/api/ai/chat.ts:159-169`) — handled cleanly, but the demo stops. | **Accepted.** Operational awareness only: budget demo turns. Model pinning was deliberately not taken during ai-chat-history.                                                                                            |

---

## Flagged for the user's own verification — not this change's work

**The production Worker received a code upload during the audit.**
`wrangler versions list` shows, on 2026-09-07:

- `11:15:12Z` — `Source: Secret Change`
- `11:15:17Z` — `Source: Unknown (version_upload)`, version `28720ee8-679d-4134-b162-253546ea5931`, now live at 100%

Those timestamps coincide exactly with a local `npm run dev`. No `wrangler deploy`
was run. `wrangler.jsonc` names the live worker `car-booklet`, and the Astro
Cloudflare adapter announced remote `IMAGES` and `SESSION` KV bindings plus Vite
tunnels on dev-server boot — so local dev may be publishing to the live Worker.

Prod was healthy afterwards (200s, correct redirects) and the dev server was
stopped. Deployment history is otherwise sparse (10 total, ~monthly), consistent
with manual deploys.

This is **not** scoped into this change — it needs a human decision about whether
`npm run dev` touching prod is acceptable for a PoC. If it is not, that is its
own change.

---

## Other open follow-ups NOT scoped here (recorded for completeness)

- **Car field length bounds.** `carSchema` / `patchSchema` in `src/pages/api/cars/index.ts` and `src/pages/api/cars/[id].ts` use `.min(1)` with no `.max()` against unbounded Postgres `TEXT` — a multi-MB `brand` can be persisted. The prompt-side half was fixed (F5 Fix A); the storage-side half was not. Source: `context/changes/ai-chat-history/follow-ups/review-fixes.md` §1. Low/medium, storage not correctness. Not triaged in this pass.
- **Stale prose.** `e2e/car-delete-blast-radius.spec.ts` docstring enumerates the delete cascade without `conversations.car_id`. Coverage itself is correct. Informational.
- **`public.set_updated_at()` lacks `SET search_path = ''`** (`supabase/migrations/20260527000000_cars_schema.sql:38-44`). `SECURITY INVOKER`, so not exploitable here; Supabase's linter flags it as `function_search_path_mutable`. Informational.
- **`context/changes/ai-chat-history/`** is `status: impl_reviewed` with all plan phases `[x]` and an APPROVED post-triage verdict — finished but never archived. `/10x-archive` has not been run on it.
