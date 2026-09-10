# Pre-demo Hardening — Plan Brief

> Full plan: `context/changes/pre-demo-fixes/plan.md`
> Research: `context/changes/pre-demo-fixes/research.md`
> Change brief: `context/changes/pre-demo-fixes/change.md`

## What & Why

Close the five loose ends a full app-state audit surfaced on 2026-09-07, before
the demo. The app is feature-complete; these are gaps between what the project
already decided it wanted and what is actually wired — an ungated CI, a reflected
auth error string, a screen-reader-silent AI reply, and four config one-liners.

## Starting Point

CI runs lint + build and nothing else, so the bypassable local pre-commit hook is
a stronger gate than the unbypassable remote one, and the project is out of
compliance with its own `test-plan.md:152`. The auth routes redirect with
`?error=${error.message}`, which the sign-in page renders verbatim inside a
styled alert — a phishing surface on the real origin plus a user-enumeration
signal, and neither route logs. `StreamingText.tsx` renders a blinking caret with
no role or live region, which is also why the R6 Playwright spec was never
written. Three test suites (419 unit/client, 73 integration, 3 e2e specs) already
exist and pass; none of them run on a PR.

## Desired End State

A PR shows four green checks, and `deploy` will not proceed past a red fast gate
or a red integration job. A crafted `?error=` link renders nothing, while a real
auth failure renders localized copy from a closed set and leaves a structured log
line. A screen-reader user hears when a reply starts and when it ends, guarded by
a deterministic spec that costs no OpenRouter quota. The build is warning-free and
the browser tab says CarBooklet.

## Key Decisions Made

| Decision              | Choice                                              | Why                                                                                                                      | Source   |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Live-region placement | Hoist into `ChatThreadContent`, not `StreamingText` | `ChatThread.tsx:87` unmounts `StreamingText` at the transition, so a region inside it could never announce completion    | Research |
| Auth mapper key       | `error.code`, with a `name`/`status` fallback       | `ErrorCode` is a real 86-member closed set and the guards _are_ re-exported from `@supabase/supabase-js`                 | Research |
| CI staging            | Three jobs in one workflow                          | Per-job PR status; a slow browser run can't block the ~10 s always-on gate                                               | Plan     |
| Deploy gating         | `needs: [ci, integration]` — e2e excluded           | Integration is deterministic and earns gating; `retries: 0` means a browser flake shouldn't block a PoC deploy           | Plan     |
| Test triggers         | Integration and e2e on PR **and** push              | `test-plan.md:153` says "CI on PR"; finding a broken critical path after merge is too late                               | Plan     |
| E2E web server        | `build && preview`, replacing `npm run dev`         | Sidesteps the flagged 2026-09-07 prod-upload question entirely, and exercises a production build                         | Research |
| R6 spec               | Write it, stubbed via `page.route`                  | Deterministic, zero quota, no forbidden `OPENROUTER_API_KEY`; R6's claim is about UI transitions, not the model's answer | Plan     |
| F10 (API error i18n)  | In scope, client-side by status                     | Touches no server code and breaks no assertion; gives the app one story about who translates what                        | Plan     |
| Parity test placement | Phase 1, not cleanup                                | Phases 4 and 6 both add keys; a guard landing afterwards ratifies rather than catches                                    | Plan     |
| Sitemap               | Set `site`, keep the integration                    | Research favoured removal, but the scope call was to keep it                                                             | Plan     |

## Scope

**In scope:** typecheck + `npm test` + integration + e2e in CI; EN/PL key-parity
test; GoTrue error-code mapper with allowlisted `?error=` and structured logging;
F10's status→i18n helper across 14 call sites; the streaming live region plus
`aria-busy`; the stubbed R6 spec and its `e2e/README.md` amendment; `.env` token
typo, `site`, `package.json` name, `Layout.astro` default title; three
`test-plan.md` corrections; the manual delete-flow checklist.

**Out of scope:** `OPENROUTER_API_KEY` anywhere (OUT OF SCOPE item A); the
all-cars dashboard, Cloudflare plan upgrade, model pinning (items B–D); whether
`npm run dev` publishes to the live Worker; `supabase/config.toml`'s `project_id`;
`carSchema` length bounds (F5 Fix B); E2E coverage of the delete UI.

## Architecture / Approach

Three groups. **Phases 1–3** wire CI in increasing cost order — fast gate, then
Docker/Supabase, then browser — so every later phase is genuinely verified on the
PR. **Phases 4–6** are the code: the two error-localization items land together,
then the a11y work with its spec. **Phase 7** is config, docs and the manual pass.

Both error surfaces follow the pattern the repo already has twice: a closed set
resolved at the render site — server-side via `getT` (`cars.astro:37,42`),
client-side via a `switch` on a discriminant (`ChatThread.tsx:145-156`). Nothing a
service authored crosses to the client as prose.

## Phases at a Glance

| Phase                          | What it delivers                                             | Key risk                                                                                               |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1. CI fast gate + parity guard | typecheck + `npm test` on every push; EN/PL parity test      | Parity test must tolerate CLDR plural suffixes or it fails on correct Polish                           |
| 2. CI integration job          | 73 tests against Docker Supabase; deploy gated on it         | The cloud-pointing `SUPABASE_URL` secret is refused by the localhost guard — the job needs its own env |
| 3. CI e2e job                  | Playwright in CI, served from a production build             | `astro preview` under the Cloudflare adapter is unproven in CI                                         |
| 4. Auth error codes (F8)       | Closed-set codes, localized copy, structured log             | A dynamic `t()` key silently returns the key if a locale entry is missed                               |
| 5. API error i18n (F10)        | Status→key helper across 14 sites                            | 14 near-identical edits invite a copy-paste slip                                                       |
| 6. Streaming a11y + R6 spec    | Live region, `aria-busy`, first component test, stubbed spec | `getByRole("status")` collides with the existing error line in strict mode                             |
| 7. Config, docs, checklist     | Four one-liners, three doc corrections, manual delete pass   | Esc may not close the delete dialog — a finding to record, not a blocker                               |

**Prerequisites:** Docker + `npx supabase start` for phases 2, 3 and 7; repository
admin to read the Actions graph; a screen reader (VoiceOver/NVDA) for phase 6;
`wrangler` access to confirm the token fix.
**Estimated effort:** ~4–6 sessions across 7 phases. Phases 1, 5 and 7 are short;
2, 3 and 6 carry the real work.

## Open Risks & Assumptions

- **`npm run preview` under `@astrojs/cloudflare` is unverified in CI.** If it
  cannot serve the built app, phase 3 needs a different server strategy — this
  surfaces as a failed phase-3 criterion, not a silent problem.
- **`supabase start` in Actions adds minutes of image pulls.** Acceptable, but if
  it proves flaky the exclusion list is the first thing to widen.
- **The `-o env` output key names must be verified** — newer CLIs emit an
  `sb_secret_…` value rather than a `service_role` JWT.
- **Phase 6's terminal announcement depends on the last message's `status`**,
  because the hook has no abort state; an abort before the first token appends no
  message at all and is handled as a separate case.
- **Esc likely does not close the delete dialog** (`AlertDialog` controlled by
  `open` with no `onOpenChange`). Recorded as a checklist observation, not scoped
  as a fix.
- The stubbed R6 spec **reverses a written decision** in `e2e/README.md:62-66`;
  phase 6 amends that doc rather than leaving it contradicted.

## Success Criteria (Summary)

- A PR against `main` runs typecheck, unit/client, integration and e2e — and a
  red fast gate or integration job stops the deploy.
- A crafted `/auth/signin?error=…` link renders nothing; a real failure renders
  localized, non-enumerating copy in EN and PL and leaves one log line with no email.
- A screen-reader user hears one announcement when a reply starts and one when it
  ends — never per token — proven by a spec that burns no OpenRouter quota.
