# Dashboard Last Entry Widget — Plan Brief

> Full plan: `context/changes/dashboard-last-entry/plan.md`

## What & Why

Show the single most-recent entry of any type on `/dashboard`, below the three deadline tiles. The PRD (`FR-006`) flagged the empty space under the tiles as a UX failure on an otherwise bare dashboard; this fills it with the user's most recent maintenance action and a one-click path into its full detail.

## Starting Point

`dashboard.astro` guards auth + car selection, fetches `getCarDeadlines`, and renders a 3-column grid of `DeadlineCard`s — with empty space below. Entries live in 4 separate tables with `entry_type` injected at the service boundary; `getCarDeadlines` already demonstrates the parallel per-table "latest" fetch this widget needs. The `/entries/[type]/[id]` detail route shipped in the prior change.

## Desired End State

A user with at least one entry sees a compact card (type label, `conducted_at` date, one-line type-specific summary) below the deadline tiles; clicking it opens that entry's detail page. A user whose car has no entries sees no widget — the slot stays empty.

## Key Decisions Made

| Decision               | Choice                                                                 | Why (1 sentence)                                                     | Source |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| "Most recent" ordering | `conducted_at` desc                                                    | Consistent with every existing list and deadline query               | Plan   |
| Widget interaction     | Compact card linking to `/entries/[type]/[id]`                         | Reuses the shipped detail route; matches the clickable-card pattern  | Plan   |
| Empty state            | Hide the widget entirely                                               | User's choice — no card when the car has zero entries                | Plan   |
| Tie-break (same date)  | Fixed type priority `repair > oil_change > inspection > insurance`     | Deterministic and test-stable; matches `EntryType` declaration order | Plan   |
| Summary line           | Type-specific key field (description / oil_details / result / insurer) | Mirrors what each list card already surfaces                         | Plan   |

## Scope

**In scope:** `getLastEntry` service function; `LastEntryCard.astro` widget; dashboard wiring.

**Out of scope:** DB/API/route/middleware changes; embedding `EntryDetail.astro`; edit/delete on the widget; type filtering; empty-state CTA; touching the deadline tiles or `getCarDeadlines`.

## Architecture / Approach

`getLastEntry(supabase, carId, userId)` fires 4 parallel `limit(1)` queries (latest per table by `conducted_at`), injects `entry_type`, and reduces the candidates to one — latest date wins, type priority breaks ties — returning `Entry | null`. `dashboard.astro` fetches it alongside `getCarDeadlines` and renders `{lastEntry && <LastEntryCard entry={lastEntry} />}` below the grid. The card is a single `<a>` to the detail route, styled to match the existing glass cards.

## Phases at a Glance

| Phase                     | What it delivers                                | Key risk                                             |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 1. `getLastEntry` service | Cross-table most-recent-entry resolver          | Tie-break determinism on same-day entries            |
| 2. Widget + wiring        | `LastEntryCard.astro` rendered on the dashboard | Hidden-when-null behavior; correct detail-route link |

**Prerequisites:** S-02 (sidebar/`AppLayout`) and `entry-detail-route` shipped — both done.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Assumes `conducted_at` is date-granular (same-day ties are real) — the type-priority tie-break exists precisely for that case.
- Assumes the detail route accepts all 4 `entry_type` values as the `[type]` segment — confirmed by the prior change.

## Success Criteria (Summary)

- Dashboard shows the correct most-recent entry with a type-specific summary, linking to its detail page.
- A car with no entries shows no widget and no error.
- Same-day entries resolve deterministically by type priority.
