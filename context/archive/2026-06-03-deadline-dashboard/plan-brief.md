# Deadline Dashboard — Plan Brief

> Full plan: `context/changes/deadline-dashboard/plan.md`

## What & Why

S-06 replaces the placeholder dashboard page with a real deadline surface (FR-012). Users need to see upcoming oil change, inspection, and insurance deadlines at a glance — the paper service booklet use case that prompted the whole product. All required date columns already exist in the DB from F-02; this slice is pure service logic + UI.

## Starting Point

`dashboard.astro` is a centered glass card showing the car name and a sign-out button. No entry data is fetched, no Topbar is rendered, and no deadline logic exists anywhere in the codebase. The three relevant columns — `oil_change_entries.conducted_at`, `inspection_entries.next_inspection_date`, `insurance_entries.renewal_date` — are populated and ready to query.

## Desired End State

`/dashboard` shows a full-page layout with the selected car's name as a heading and three deadline cards in a responsive 3-column grid. Each card is red (overdue or ≤30 days), yellow (31–90 days), or green (>90 days). Cards with no entries show a neutral "No data" placeholder. The oil change card shows the computed next-due date (last conducted_at + 1 year) plus the km threshold if mileage was logged. The inspection card handles the case where `next_inspection_date` was not recorded. Topbar is present as on all other pages.

## Key Decisions Made

| Decision                     | Choice                                            | Why (1 sentence)                                                         | Source |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| Scope                        | Selected car only                                 | Fits existing selected-car paradigm; no extra queries needed             | Plan   |
| Urgency thresholds           | Overdue + ≤30d = red; ≤90d = yellow; >90d = green | Standard maintenance reminder cadence                                    | Plan   |
| Oil change urgency           | Date-only (conducted_at + 1yr)                    | App has no current odometer — mileage threshold is informational only    | Plan   |
| Missing next_inspection_date | Show last date + "next date not set"              | Honest; avoids fabricating a deadline                                    | Plan   |
| Empty state                  | Show card with "No data" placeholder              | Consistent layout; prompts user to log                                   | Plan   |
| Service layer                | New `getCarDeadlines()` in entries.ts             | Single fetch point; keeps dashboard template clean                       | Plan   |
| Rendering                    | Pure Astro SSR, no React island                   | Cards are static; no interactivity needed                                | Plan   |
| Insurance query order        | `ORDER BY renewal_date DESC`                      | Surfaces the active (latest-expiry) policy, not the most recently logged | Plan   |

## Scope

**In scope:**

- `DeadlineStatus`, `OilChangeDeadline`, `InspectionDeadline`, `InsuranceDeadline`, `CarDeadlines` types in `src/types.ts`
- `getCarDeadlines()` service function in `src/lib/services/entries.ts`
- `src/components/DeadlineCard.astro` — status-colored card with slot
- Full redesign of `src/pages/dashboard.astro` — full-page layout, Topbar, 3 deadline cards

**Out of scope:**

- No schema changes
- No configurable thresholds
- No multi-car overview
- No mileage-based urgency (informational only)
- No API endpoint (SSR fetch only)

## Architecture / Approach

`getCarDeadlines()` runs three parallel `Promise.all` Supabase queries (one per entry type, `LIMIT 1`), computes next-due dates and status in TypeScript, and returns a typed `CarDeadlines` object. `dashboard.astro` calls it in the frontmatter (SSR) and passes the result to three `DeadlineCard.astro` instances. No React, no client-side data fetch, no new API route.

## Phases at a Glance

| Phase                 | What it delivers                                               | Key risk                                                                                         |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Service + types    | `getCarDeadlines()` + deadline types; full data contract ready | Status computation logic must handle null dates and the inspection "no_next_date" case correctly |
| 2. Dashboard redesign | Full-page dashboard with 3 deadline cards; Topbar added        | Layout consistency with rest of app; urgency color mapping                                       |

**Prerequisites:** S-04 and S-05 both done (all entry tables populated and entry management working)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- Oil change interval is hardcoded at 1 year / 10 000 km — no per-car configuration. Acceptable for v1.
- "Most recent insurance" is the one with the latest `renewal_date`, not the latest `conducted_at`. This is correct for active-policy lookup but may surprise if a user logs a policy amendment as a new entry.

## Success Criteria (Summary)

- All three deadline cards render with correct urgency colors for a car with at least one entry of each type
- Empty/no-data states and the inspection "no next date" state render correctly
- `npm run build` passes; no regressions on `/entries` or `/ai-chat`
