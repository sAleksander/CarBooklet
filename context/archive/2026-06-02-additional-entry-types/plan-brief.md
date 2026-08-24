# Additional Entry Types — Plan Brief

> Full plan: `context/changes/additional-entry-types/plan.md`

## What & Why

S-04 extends the service history from repair-only to all four entry types required by the PRD: oil changes (FR-005), technical inspections (FR-006), and insurance records (FR-007). These three types are the data source for the upcoming S-06 deadline dashboard — oil change intervals, inspection expiry dates, and insurance renewal dates are the "must not miss" deadlines the app is built around.

## Starting Point

S-03 shipped `/entries` with full repair entry logging: service functions, GET/POST API route, `RepairEntryForm` + `RepairEntryList` + `RepairEntries` island, and an Astro page that server-fetches repair entries and mounts the island. The F-02 schema already has all three new tables live in Supabase (`oil_change_entries`, `inspection_entries`, `insurance_entries`) with RLS. TypeScript types for all three entry types are already exported from `src/types.ts`.

## Desired End State

A user opens `/entries` and sees four tabs: Repairs | Oil Changes | Inspections | Insurance. Each tab has its own add-form and history list. Switching tabs is instant (no page navigation). Adding an entry in any tab prepends it to that tab's list and clears the form. All four tabs' entries persist across page reloads.

## Key Decisions Made

| Decision                | Choice                                               | Why (1 sentence)                                                                          |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Page layout             | Tabs on /entries                                     | Single nav item, all history in one place, mirrors common mobile car apps.                |
| Inspection result field | Pass/Fail select (stored "Passed"/"Failed")          | Unambiguous, maps directly to the Polish inspection outcome, no free-text queries needed. |
| Default tab             | Repairs                                              | No behavioral regression; repair is the primary entry type.                               |
| API route structure     | 3 separate routes (pattern: repair.ts)               | Matches established pattern; each route is independently testable.                        |
| Island design           | Single EntriesTabs island + 4 per-type orchestrators | Tab state in one place; each type's form/list is still independently changeable.          |
| List components         | Per-type (OilChangeEntryList, etc.)                  | Each list is tailored to its type; avoids premature abstraction at 4 types.               |
| Topbar                  | No change                                            | Single "Entries" link stays; no nav changes needed.                                       |

## Scope

**In scope:**

- 6 service functions (get + create for each of 3 new types)
- 3 new API routes: /api/entries/oil-change, /api/entries/inspection, /api/entries/insurance
- 9 new React component files (form + list + orchestrator per type)
- EntriesTabs island (tab controller)
- entries.astro update (4 parallel fetches + EntriesTabs mount)

**Out of scope:**

- Edit / delete of any entry type (S-05)
- AI prompt injection of entry context (S-02 addendum)
- Tab persistence in localStorage
- Entry filtering or search

## Architecture / Approach

Pure replication of the S-03 stack, three times over. The backend is three independent table-specific routes; the frontend is three independent form/list/orchestrator triads controlled by a single `EntriesTabs` island that owns `activeTab` state. The Astro page runs 5-way `Promise.all` (car + 4 entry lists) and passes all four sets to `EntriesTabs` as initial props. Conditional rendering (`activeTab === "oil_change" && <OilChangeEntries ...>`) means only one tab mounts at a time — no stale state between tabs.

## Phases at a Glance

| Phase                   | What it delivers                                        | Key risk                                                                                                            |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1. Service + API Routes | All 3 new entry types curl-verifiable; backend complete | Zod schema for inspection must restrict result to ["Passed", "Failed"] exactly                                      |
| 2. React Components     | All 9 per-type components + EntriesTabs ready to mount  | EntriesTabs props shape must match what entries.astro passes in Phase 3                                             |
| 3. Astro Page Update    | /entries shows 4 tabs; full smoke test                  | entries.astro Promise.all must not error if any one fetch fails (car not found → already redirected before fetches) |

**Prerequisites:** F-02 (schema live), S-01 (car management done), S-03 (repair entry pattern established) — all done.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- The `insurer` and `result` fields may be NOT NULL in the DB (the F-02 impl-review commit message mentions "insurer/result NOT NULL") but are typed as `string | null` in `src/types.ts`. The API routes treat them as optional/nullable — if the DB constraint is stricter, inserts with null values will fail at runtime. Verify after Phase 1 manual testing.
- Three entry types in one slice is the heaviest scope slice on the roadmap. If time pressure mounts, insurance entries (FR-007) are the lowest safety stakes and could defer to a fast-follow without blocking S-05 or S-06's oil change / inspection paths.

## Success Criteria (Summary)

- User can switch between all four tabs on /entries and add entries in each
- Oil changes, inspection (pass/fail + next due date), and insurance (renewal date) entries persist across reloads
- Insurance submission is blocked without renewal_date; inspection result is restricted to Passed/Failed
