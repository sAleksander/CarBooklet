# Localization (English + Polish) — Plan Brief

> Full plan: `context/changes/i18n-en-pl/plan.md`

## What & Why

Make the app fully bilingual (English + Polish) with a visible language toggle whose choice persists across sessions. The app is English-only today; roadmap slice **S-06** adds the missing localization so Polish-speaking users can use it in their language.

## Starting Point

No i18n exists (no config, no dependency) on Astro 6 SSR + React 19 islands + Cloudflare Workers. A clean cookie→`locals`→island-prop rail already exists for `selected_car_id` (set by a POST route, read in middleware, passed to islands) — the `lang` cookie reuses it exactly. Strings are hardcoded English across ~9 `.astro` pages, 7 `.astro` components, and ~43 `.tsx` components; nav labels are already centralized.

## Desired End State

A signed-in user toggles language in the sidebar; the cookie is set, the page reloads, and the whole app — sidebar, dashboard, entries (tabs/lists/forms/dialogs/detail), cars, AI chat — plus the public landing and auth pages render in the chosen language. Entry-type labels are localized; dates render as they do today. No hydration warnings; first-time visitors see English.

## Key Decisions Made

| Decision               | Choice                               | Why (1 sentence)                                                        | Source |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------- | ------ |
| i18n mechanism         | i18next + react-i18next              | User chose the mature library over a lighter custom dictionary          | Plan   |
| Locale carrier         | `lang` cookie, no URL change         | Near-zero routing churn; reuses the proven cookie→locals→prop rail      | Plan   |
| Default + detection    | English default, cookie overrides    | Deterministic, matches the current all-English app                      | Plan   |
| Localization scope     | Static chrome + entry-type labels    | Covers what users read in normal use; server errors out of scope        | Plan   |
| Date/number formatting | Left as-is (no Intl locale)          | Explicit user decision — overrides the "dates" part of the scope option | Plan   |
| Toggle placement       | Sidebar footer (+ mobile drawer)     | Consistent home for account-level controls; no-JS form like Sign out    | Plan   |
| Surfaces in v1         | All (protected app + landing + auth) | Matches roadmap intent; no half-translated app                          | Plan   |

## Scope

**In scope:** i18next/react-i18next setup; `en`/`pl` dictionaries; middleware locale resolution; `<html lang>`; `/api/lang/[locale]` cookie endpoint; sidebar toggle; translating all UI text + entry-type labels across every surface.

**Out of scope:** URL-prefixed locales; date/number reformatting; server-side zod & Supabase auth error translation; storing locale in the user profile; a third language; a public-page switcher.

## Architecture / Approach

Locale is resolved once in middleware from the `lang` cookie into `Astro.locals.lang` (default `en`). `.astro` files translate via a concurrency-safe `getT(locale)` (fixed-language translator — never mutate a shared i18next instance under Workers concurrency). React **island roots** receive `lang` as a prop and initialize the react-i18next singleton to it before first render (resources bundled) so SSR and client hydrate in the same language; island descendants just call `useTranslation`. The toggle is a no-JS `<form>` POST that sets the cookie and reloads, making the next render server-authoritative.

## Phases at a Glance

| Phase                          | What it delivers                                   | Key risk                                                           |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Foundation + sidebar toggle | Full i18n machine proven end-to-end on the sidebar | i18next under SSR concurrency + island hydration parity — the crux |
| 2. Protected app surfaces      | Dashboard, entries, cars, AI chat translated       | Large string sweep; wiring each island root correctly              |
| 3. Public surfaces             | Landing + auth pages translated                    | Form-island hydration on auth pages                                |

**Prerequisites:** S-05 (entry-detail-actions) should land first — it adds `EntryDetailEditor.tsx` and edits the entry list/orchestrator files that Phase 2 also touches.
**Estimated effort:** ~2–3 sessions across 3 phases (Phase 1 is the hard part; 2–3 are breadth).

## Open Risks & Assumptions

- **react-i18next + Astro SSR concurrency/hydration is the central risk.** This is the cost of choosing i18next over a lighter custom helper; Phase 1 front-loads and explicitly verifies it (no `changeLanguage()` on a shared SSR instance; `lang` prop + bundled resources for parity).
- **S-05 overlaps Phase 2 files.** If S-05 hasn't merged, Phase 2 will conflict — sequence S-06 after it.
- Assumes only island _roots_ (not all 43 `.tsx`) need i18next wiring — true given the component tree, but the implementer must enumerate `client:` directives to confirm.
- Scope drift from the roadmap's "UI-layer-only" framing is mild here: cookie + middleware are light server touches, no DB/API contract changes.

## Success Criteria (Summary)

- Toggling language switches every surface and the choice persists across sessions; first visit defaults to English.
- Server-rendered pages load directly in the cookie's locale with no hydration warnings in either language.
- Entry-type labels localized; existing flows (entries CRUD, car CRUD, AI chat, auth) work in both languages.
