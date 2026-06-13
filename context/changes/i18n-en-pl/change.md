---
change_id: i18n-en-pl
title: Localization — English + Polish with a persistent language toggle
status: implementing
created: 2026-06-10
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap slice **S-06** (`context/foundation/roadmap.md`). Make the whole app switchable
between English and Polish from a visible control; the choice persists across sessions and
covers every user-facing string (sidebar, landing, dashboard, entries, detail, forms, auth).

**Blocking unknown — resolve before `/10x-plan`:** no localization library exists in the
codebase today. The central decision is the i18n approach (`astro:i18n` routing vs.
`i18next` vs. a lightweight custom dictionary) and whether language is URL-prefixed
(`/pl/...`), cookie-based, or both. The roadmap recommends a `/10x-shape` or infra-research
pass to settle this first. Logged in the roadmap's Open Roadmap Questions.

Other open points (decide at planning): where the choice is stored (cookie vs. user profile)
and how the initial language is picked (browser `Accept-Language` vs. fixed default);
whether dynamic data (entry-type labels, dates, zod/Supabase error messages) is localized or
only static chrome.

Scope/architecture flag: S-06 is the first cross-cutting concern in this roadmap — it
touches every page, not a single vertical. If language ends up persisted server-side or
routes become locale-prefixed, it breaches the original "entire delta is in the UI layer /
no backend changes" framing in the roadmap Vision recap — revisit that when planning.
Post-v2 addition; fold into `prd-v2.md` on the next PRD pass.
