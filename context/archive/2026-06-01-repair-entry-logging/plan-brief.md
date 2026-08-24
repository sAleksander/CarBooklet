# Repair Entry Logging — Plan Brief

> Full plan: `context/changes/repair-entry-logging/plan.md`

## What & Why

S-03: the first user-facing entry logging slice. Lets a logged-in user add repair entries (date, description, optional cause + mileage) for their selected car and see all previous entries on a dedicated page. This is the data-capture prerequisite for S-05 (edit/delete) and, once S-02 is complete, for AI prompts that reference logged history.

## Starting Point

The `repair_entries` table is live in Supabase (F-02) with RLS enforcing per-user access. `RepairEntry` and `RepairEntryFormData` types exist in `src/types.ts`. The selected-car cookie mechanism (S-01) is in place. No entries service, API routes, components, or pages exist yet.

## Desired End State

A user navigates to `/entries` via the Topbar, sees a form pre-filled with today's date above a list of their car's repair entries. Submitting the form clears it and places the new entry at the top of the list without a page reload. Visiting the page with no car selected redirects to `/cars`.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                                  | Source |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `cause` field UI requirement | Optional                                            | DB column is nullable; roadmap "must not be optional" note was a planning mistake | Plan   |
| Page placement               | New `/entries` page                                 | Clean separation from car management; scalable when S-04 adds more entry types    | Plan   |
| Read scope                   | Add + list (create + view)                          | A form with no visible list can't confirm the entry was saved                     | Plan   |
| Text field component         | shadcn Textarea (install)                           | Consistent styling with other shadcn inputs                                       | Plan   |
| Post-submit behaviour        | Clear form + prepend to list                        | Instant confirmation; user can add another entry without a click                  | Plan   |
| Date default                 | Today's date pre-filled                             | Most entries are logged the same day; reduces friction                            | Plan   |
| Topbar nav                   | Add "Entries" link                                  | Directly discoverable; doesn't require visiting Dashboard first                   | Plan   |
| API auth                     | `context.locals.user` guard + `createClient` for DB | Matches the pattern fixed during ai-integration-scaffold impl-review              | Plan   |

## Scope

**In scope:**

- `src/lib/services/entries.ts` — `getRepairEntries`, `createRepairEntry`
- `src/pages/api/entries/repair.ts` — GET + POST
- `src/components/entries/RepairEntryForm.tsx`, `RepairEntryList.tsx`, `RepairEntries.tsx`
- `src/pages/entries.astro` — protected page, server-fetches entries
- `src/middleware.ts` — add `/entries` to PROTECTED_ROUTES
- `src/components/Topbar.astro` — add Entries nav link
- `src/components/ui/textarea.tsx` — shadcn Textarea install

**Out of scope:**

- Edit / delete entries (S-05)
- Other entry types: oil change, inspection, insurance (S-04)
- Filtering, pagination, or search
- AI integration with entries (S-02 addendum)
- Toast notifications (inline errors only, matching existing convention)

## Architecture / Approach

Three-layer stack mirroring car management. Service accepts `SupabaseClient` as first param; API route uses `context.locals.user` for the auth guard then creates a Supabase client for DB calls; React island is pre-seeded from server-fetched data (no loading spinner on first paint). Form reset is driven by a `formKey` counter increment — avoids a reset callback prop and mirrors the island pattern from `ChatDemo.tsx`.

## Phases at a Glance

| Phase                      | What it delivers                                         | Key risk                                                    |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Service + API Routes    | GET + POST `/api/entries/repair` verifiable via curl     | `entry_type` virtual field injection easy to miss           |
| 2. React Components        | RepairEntryForm + RepairEntryList + RepairEntries island | Textarea install must precede the form component            |
| 3. Astro Page + Navigation | `/entries` page + Topbar link + end-to-end smoke test    | Topbar `selectedCarId` check path (no car → /cars redirect) |

**Prerequisites:** F-02 (entries-schema) and S-01 (car-management) — both done.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- The `cause` field is nullable in the DB and optional in the form — if the product direction shifts to requiring it, a schema `NOT NULL` migration and UI validation change are needed.
- `entry_type` virtual field must be injected in the service layer on every query — forgetting this causes TypeScript errors downstream (e.g., when `RepairEntries` tries to use the `Entry` union).
- S-04 (more entry types) will need to decide whether to share this entries page or add new pages per type — that decision is deferred.

## Success Criteria (Summary)

- User can add a repair entry from `/entries` and see it immediately in the list without a page reload
- Entries persist across page reloads (server-fetched from Supabase)
- Unauthenticated access and no-selected-car state both redirect correctly
