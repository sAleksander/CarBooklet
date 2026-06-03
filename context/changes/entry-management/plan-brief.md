# Entry Management — Plan Brief

> Full plan: `context/changes/entry-management/plan.md`

## What & Why

S-05 adds Edit and Delete to all four entry types (repair, oil change, inspection, insurance) on the `/entries` page. The PRD (FR-008) mandates delete confirmation via an `AlertDialog` and in-place edit via a `Dialog` modal. Without this, the app has no way to correct mistakes after an entry is created.

## Starting Point

All four entry types support create + list (S-03 and S-04 complete). The service layer has 8 functions (get + create × 4), but no update or delete. Entry cards render as read-only with no action buttons. `AlertDialog` is installed; `Dialog` is not.

## Desired End State

Every entry card in all four tabs shows "Edit" and "Delete" buttons in the header row. Delete opens an `AlertDialog` ("Delete repair entry from June 2, 2026?") — Cancel closes without action, Delete waits for the server, then removes the entry from the list. Edit opens a `Dialog` modal pre-filled with the entry's data — saving sends a PATCH and replaces the entry in place.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Separate `*EntryEditForm.tsx` per type | 4 new files, no reuse of create forms | Avoids coupling create and edit paths — simpler and safer to evolve independently |
| Delete: wait-for-server | No optimistic UI | PRD-mandated confirmation dialog is already the safety net; optimistic delete adds complexity for minimal perceived benefit |
| Ownership check in service layer | `.eq("user_id", userId)` in every update/delete query | Double ownership check (RLS + app-layer) prevents insecure direct object references without needing `getCarById` |
| Dialog for edit, AlertDialog for delete | Each used per its semantic intent | `Dialog` is for non-destructive overlays; `AlertDialog` is for irreversible actions — matches shadcn/ui design contract |
| Error on delete kept in open dialog | Do NOT close dialog on error | Closing on error loses the error message and gives the user no way to retry or understand what happened |

## Scope

**In scope:**
- Update + delete service functions for all 4 entry types (8 new functions)
- PATCH + DELETE handlers on all 4 API routes
- 4 new `*EntryEditForm.tsx` components
- Edit/Delete action buttons on all 4 `*EntryList.tsx` components
- `Dialog` + `AlertDialog` state management in all 4 `*Entries.tsx` orchestrators
- Install shadcn `Dialog` component

**Out of scope:**
- Bulk delete
- Undo / soft delete
- Pagination or filtering
- Create flow changes

## Architecture / Approach

Three-phase build following the existing S-04 pattern: service layer first (verifiable with curl), then edit form components, then UI wiring. Ownership is enforced at the Supabase query level (`.eq("user_id", userId)`) on top of RLS. The edit modal uses `Dialog`; delete confirmation uses the already-installed `AlertDialog`. State for both lives in each `*Entries.tsx` orchestrator (`editingEntry`, `deletingEntry`, `isDeleting`, `deleteError`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Service Functions + API Route PATCH/DELETE | Full CRUD backend, curl-testable | Zod schema drift between POST and PATCH if not kept in sync |
| 2. Edit Form Components + Install Dialog | 4 pre-filled edit forms, `Dialog` installed | Form pre-population edge cases (null optional fields) |
| 3. List + Orchestrator Updates | Complete UX — buttons, modals, state wired for all 4 types | Dialog open/close state management across 4 parallel orchestrators |

**Prerequisites:** S-03 (repair entry logging) and S-04 (additional entry types) — both done.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- `Dialog` install via `npx shadcn@latest add dialog` must happen before Phase 2 code is written — if the component isn't available the TypeScript build fails.
- All four tables already exist from F-02 — no schema changes needed (assumed correct).

## Success Criteria (Summary)

- All 4 entry types show Edit and Delete buttons; each action works correctly end-to-end
- Network error on delete shows error inside the still-open confirmation dialog (entry not removed)
- `npm run build` and `npm run lint` pass with no new errors after each phase
