# Root Routing + Minimal Landing Page — Plan Brief

> Full plan: `context/changes/root-routing-landing/plan.md`

## What & Why

The root URL (`/`) currently shows the 10x Astro Starter boilerplate regardless of auth state — wrong branding, no redirect. This change replaces it with a minimal CarBooklet-branded landing page and adds a server-side redirect so authenticated users land on `/dashboard` immediately.

## Starting Point

`src/pages/index.astro` renders `Welcome.astro`, which contains the starter boilerplate (generic headline, generic feature cards). The middleware already resolves `Astro.locals.user` on every request, so auth state is available at `/` with no extra infrastructure.

## Desired End State

Visiting `/` while logged in → instant redirect to `/dashboard`. Visiting `/` while logged out → a clean landing page with the "CarBooklet" headline, a one-sentence value prop, and Sign In / Sign Up CTAs — in the existing cosmic visual style.

## Key Decisions Made

| Decision            | Choice                                                                                                     | Why (1 sentence)                                                                    | Source |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| Redirect placement  | In `index.astro`, not middleware                                                                           | Keeps middleware focused on protection; Astro SSR makes page-level redirect trivial | Plan   |
| Content depth       | Hero + CTAs only (no feature cards)                                                                        | PRD specifies "minimal"; clean signal without maintenance overhead                  | Plan   |
| Component structure | Rewrite Welcome.astro, keep `<Welcome />` in index                                                         | Minimal diff — one user of the component, no new files                              | Plan   |
| Headline            | "CarBooklet"                                                                                               | Matches app name                                                                    | Plan   |
| Tagline             | "Track your car's full service history — repairs, oil changes, inspections, and insurance — in one place." | Directly names the app's purpose                                                    | Plan   |

## Scope

**In scope:**

- Auth-state redirect at `/` (authenticated → `/dashboard`)
- Rewrite `Welcome.astro` copy: headline + tagline
- Remove feature cards from Welcome.astro

**Out of scope:**

- Changes to `src/middleware.ts` or `PROTECTED_ROUTES`
- Any new components, routes, or layouts
- Any API, data, or auth logic changes

## Architecture / Approach

Two edits, phased. Phase 1 adds one redirect check to `index.astro` frontmatter. Phase 2 rewrites the content of `Welcome.astro` — only copy and card removal, no structural changes to the cosmic shell.

## Phases at a Glance

| Phase                   | What it delivers                                | Key risk                                              |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| 1. Auth-State Redirect  | `/` redirects logged-in users to `/dashboard`   | None — one-line change using already-resolved locals  |
| 2. Landing Page Content | CarBooklet-branded hero + CTAs, no starter copy | Visual regression in Topbar (mitigated by smoke test) |

**Prerequisites:** None — S-01 has no dependencies per roadmap.
**Estimated effort:** ~1 session, 2 files touched.

## Open Risks & Assumptions

- No risks identified — both changes are isolated to files with a single concern and no downstream consumers.

## Success Criteria (Summary)

- Authenticated user visits `/` → lands on `/dashboard` (no boilerplate flash).
- Unauthenticated user visits `/` → sees "CarBooklet" headline, tagline, and Sign In / Sign Up buttons.
- All protected pages smoke-tested with no regressions.
