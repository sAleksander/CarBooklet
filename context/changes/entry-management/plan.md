# Entry Management Implementation Plan

## Overview

Add edit and delete to all four entry types (repair, oil change, inspection, insurance). Each entry card gains Edit and Delete action buttons in its header row. Delete requires an `AlertDialog` confirmation (PRD-mandated). Edit opens a `Dialog` modal containing a pre-populated entry-type-specific form that sends a PATCH request on submit.

## Current State Analysis

- All four entry types support create and list (S-03, S-04 complete).
- `src/lib/services/entries.ts` has 8 functions (get + create × 4 types) — no update or delete.
- Each `*EntryList.tsx` renders read-only cards with no action buttons.
- Each `*Entries.tsx` orchestrator manages `entries` state + `formKey` only.
- `AlertDialog` (shadcn/ui) is installed — ideal for delete confirmation.
- `Dialog` (shadcn/ui) is **not** installed — needed for the edit modal; must be installed in Phase 2.
- `Button variant="destructive"` and `variant="ghost" size="sm"` are available for action buttons.

## Desired End State

On the `/entries` page, each entry card in any of the four tabs shows "Edit" and "Delete" buttons in its header row. Clicking Delete opens a confirmation dialog ("Delete repair entry from June 2, 2026?") with Cancel and Delete buttons — Cancel closes without action, Delete calls the API and removes the entry from the list on success. Clicking Edit opens a modal form pre-filled with the entry's data — submitting sends a PATCH and replaces the entry in the list.

### Key Discoveries

- Service pattern for update: `.update({...data}).eq("id", entryId).eq("user_id", userId).select().single()` — double-eq provides application-layer ownership check on top of RLS; PGRST116 means not found/not owned → return null.
- Service pattern for delete: `.delete().eq("id", entryId).eq("user_id", userId)` — RLS + userId filter ensures ownership.
- PATCH route: body contains `id` (entry UUID) + all editable fields; no `car_id` needed (already on the record).
- DELETE route: `id` from query param (`?id=<uuid>`); returns 204 No Content.
- Card header structure: `<div className="mb-1 flex items-center justify-between">` — date on left, mileage + action buttons on right.
- Edit modal uses `Dialog` (not `AlertDialog`) — semantically correct for forms; requires `npx shadcn@latest add dialog` before Phase 2.
- Delete confirmation uses existing `AlertDialog` — already installed from S-01.
- `getCarById` for ownership is NOT needed in PATCH/DELETE routes — ownership is checked in the service via `.eq("user_id", userId)` and the Supabase RLS policies; a null return from the service means 404.

## What We're NOT Doing

- No bulk delete
- No undo / soft delete — hard delete as PRD specifies; the confirmation dialog is the safety net
- No pagination or filtering of the entry list
- No change to the create flow or form components
- No reuse of existing `*EntryForm.tsx` for edit — 4 separate `*EntryEditForm.tsx` files to avoid coupling create and edit paths

## Implementation Approach

**Service layer**: Add `update*Entry(supabase, entryId, userId, data)` and `delete*Entry(supabase, entryId, userId)` for each of the 4 types (8 new functions). Both enforce ownership at the DB query level.

**API routes**: Add `PATCH` and `DELETE` exports to each of the 4 existing route files. PATCH validates with a Zod schema identical to POST but replacing `car_id` with `id`; returns `{ entry }`. DELETE takes `?id=` and returns 204.

**Edit form components**: 4 new `*EntryEditForm.tsx` files, one per type. Each is pre-populated from the passed entry prop, sends PATCH on submit, calls `onSuccess(updatedEntry)` on success, and has a Cancel button that calls `onCancel()`.

**List + Orchestrator**: Each `*EntryList.tsx` gains `onEdit` and `onDelete` callback props and renders two ghost action buttons per card. Each `*Entries.tsx` gains `editingEntry`, `deletingEntry`, and `isDeleting` state, renders an `AlertDialog` for delete confirmation and a `Dialog` for the edit form.

## Critical Implementation Details

**PATCH response shape**: The update service function returns `*Entry | null` (null when the entry doesn't exist or the user doesn't own it). The API route maps null → 404 and a valid entry → `{ entry }` with status 200 (not 201 — this is an update, not a creation).

**Delete-then-filter**: The wait-for-server delete flow is: set `isDeleting(true)` → call DELETE → on success, `setEntries(prev => prev.filter(e => e.id !== deletingEntry.id))` then `setDeletingEntry(null)` → on error, show `apiError` in the confirmation dialog and reset `isDeleting`. Do NOT close the dialog on error.

**Dialog vs AlertDialog**: `Dialog` wraps the edit form (installed in Phase 2). `AlertDialog` wraps the delete confirmation (already installed). Both are controlled (`open={editingEntry !== null}` / `open={deletingEntry !== null}`). Closing is handled by setting the relevant state to `null`.

---

## Phase 1: Service Functions + API Route PATCH/DELETE

### Overview

Add `update*Entry` and `delete*Entry` service functions for all 4 types, and add `PATCH` + `DELETE` handlers to the 4 existing API route files. After this phase the full CRUD chain is verifiable with `curl`.

### Changes Required

#### 1. Add 8 service functions

**File**: `src/lib/services/entries.ts`

**Intent**: Add `update*Entry(supabase, entryId, userId, data)` and `delete*Entry(supabase, entryId, userId)` for each of the 4 types. Both functions filter by `userId` as an application-layer ownership check on top of RLS.

**Contract**:
- `updateRepairEntry(supabase: SupabaseClient, entryId: string, userId: string, data: RepairEntryFormData): Promise<RepairEntry | null>` — UPDATE `repair_entries` WHERE `id = entryId` AND `user_id = userId`, `.select().single()`. On PGRST116 return null; on other errors throw. Return row + `entry_type: 'repair' as const`.
- `deleteRepairEntry(supabase: SupabaseClient, entryId: string, userId: string): Promise<void>` — DELETE WHERE `id = entryId` AND `user_id = userId`. Throw on `res.error`.
- Repeat the same two functions for oil change (`oil_change_entries`, `entry_type: 'oil_change'`), inspection (`inspection_entries`, `entry_type: 'inspection'`), and insurance (`insurance_entries`, `entry_type: 'insurance'`).

#### 2. Add PATCH + DELETE to repair route

**File**: `src/pages/api/entries/repair.ts`

**Intent**: Allow updating and deleting individual repair entries by their UUID. Both handlers verify the entry belongs to the authenticated user via the service layer.

**Contract**:
- `PATCH`: Parse body, validate with Zod:
  ```ts
  z.object({
    id: z.uuid(),
    conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mileage: z.number().int().min(0).nullable().optional(),
    description: z.string().min(1, "Description is required"),
    cause: z.string().nullish().transform(v => v ?? null),
  })
  ```
  Call `updateRepairEntry(supabase, id, user.id, { conducted_at, mileage, description, cause })`. If null → 404 `{ error: "Entry not found" }`. Return `{ entry }` with status 200.
- `DELETE`: Read `id` from `new URL(context.request.url).searchParams.get("id")`. Validate as UUID. Call `deleteRepairEntry(supabase, id, user.id)`. Return `new Response(null, { status: 204 })`.
- Both: auth guard (`context.locals.user`), supabase client, and 401/503 patterns match existing GET/POST.

#### 3. Add PATCH + DELETE to oil-change route

**File**: `src/pages/api/entries/oil-change.ts`

**Contract**: Same structure as repair. PATCH Zod schema: `id`, `conducted_at`, `mileage`, `oil_details: z.string().nullish().transform(v => v ?? null)`. Calls `updateOilChangeEntry` / `deleteOilChangeEntry`.

#### 4. Add PATCH + DELETE to inspection route

**File**: `src/pages/api/entries/inspection.ts`

**Contract**: PATCH Zod schema: `id`, `conducted_at`, `mileage`, `result: z.enum(["Passed","Failed"]).nullable().optional().transform(v => v ?? null)`, `next_inspection_date` regex + nullable optional transform. Calls `updateInspectionEntry` / `deleteInspectionEntry`.

#### 5. Add PATCH + DELETE to insurance route

**File**: `src/pages/api/entries/insurance.ts`

**Contract**: PATCH Zod schema: `id`, `conducted_at`, `mileage`, `insurer: z.string().nullish().transform(v => v ?? null)`, `policy_start_date` regex + nullable optional transform, `renewal_date` required regex. Calls `updateInsuranceEntry` / `deleteInsuranceEntry`.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` passes with no TypeScript errors

#### Manual Verification

- `curl -X PATCH /api/entries/repair` with `{ id, conducted_at, description }` returns `{ entry }` 200 with updated fields
- `curl -X DELETE "/api/entries/repair?id=<uuid>"` returns 204
- PATCH with a non-existent or another user's entry id returns 404
- DELETE without session returns 401

**Implementation Note**: After automated + curl verifications pass, confirm before proceeding to Phase 2.

---

## Phase 2: Edit Form Components + Install Dialog

### Overview

Install the shadcn `Dialog` component, then create 4 `*EntryEditForm.tsx` components — one per entry type. Each is pre-populated from a passed entry and sends PATCH on submit.

### Changes Required

#### 1. Install shadcn Dialog

**File**: `src/components/ui/dialog.tsx` (via shell — `npx shadcn@latest add dialog`)

**Intent**: Provide a semantically correct modal container for the edit forms. `Dialog` is the correct component for non-destructive overlays; `AlertDialog` (already installed) is reserved for delete confirmation.

**Contract**: Run `npx shadcn@latest add dialog`. Exports `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`.

#### 2. RepairEntryEditForm

**File**: `src/components/entries/RepairEntryEditForm.tsx`

**Intent**: Edit form for repair entries. Pre-populates all fields from the passed entry and sends PATCH on submit. Structurally mirrors `RepairEntryForm.tsx` but with initial state from the entry and PATCH semantics.

**Contract**:
- Props: `{ entry: RepairEntry; onSuccess: (entry: RepairEntry) => void; onCancel: () => void }`
- Initial form state: `{ conducted_at: entry.conducted_at, description: entry.description, cause: entry.cause ?? '', mileage: entry.mileage }`
- Submits `PATCH /api/entries/repair` body: `{ id: entry.id, conducted_at, description, cause, mileage }`.
- On success: call `onSuccess(json.entry)`.
- Has a Cancel `<Button variant="outline">` that calls `onCancel()`.
- Button: "Save changes" / "Saving…" while loading.
- Requires `description` non-empty (same validation as create form).

#### 3. OilChangeEntryEditForm

**File**: `src/components/entries/OilChangeEntryEditForm.tsx`

**Contract**: Props `{ entry: OilChangeEntry; onSuccess(entry): void; onCancel(): void }`. Pre-fills `conducted_at`, `oil_details`, `mileage`. Sends `PATCH /api/entries/oil-change` with `{ id, conducted_at, oil_details, mileage }`. Button: "Save changes".

#### 4. InspectionEntryEditForm

**File**: `src/components/entries/InspectionEntryEditForm.tsx`

**Contract**: Pre-fills `conducted_at`, `result` (as Select value: `entry.result ?? "none"`), `next_inspection_date`, `mileage`. Sends `PATCH /api/entries/inspection`. Uses same shadcn `<Select>` pattern as `InspectionEntryForm`.

#### 5. InsuranceEntryEditForm

**File**: `src/components/entries/InsuranceEntryEditForm.tsx`

**Contract**: Pre-fills `conducted_at`, `insurer`, `policy_start_date`, `renewal_date`, `mileage`. Validates `renewal_date` non-empty. Sends `PATCH /api/entries/insurance`.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes with no TypeScript errors in new files

#### Manual Verification

- Edit forms render without console errors (verified in Phase 3 once wired up)

**Implementation Note**: After automated checks pass, confirm before proceeding to Phase 3.

---

## Phase 3: List + Orchestrator Updates

### Overview

Add Edit/Delete action buttons to all 4 entry list components and add the modal/dialog state management to all 4 orchestrators. This phase wires together the services (Phase 1) and edit forms (Phase 2) into a complete UX.

### Changes Required

#### 1. Update RepairEntryList

**File**: `src/components/entries/RepairEntryList.tsx`

**Intent**: Add `onEdit` and `onDelete` callback props and render Edit + Delete action buttons in the card header row, on the right side next to (or replacing) the mileage.

**Contract**:
- New props: `onEdit: (entry: RepairEntry) => void; onDelete: (entry: RepairEntry) => void`.
- Card header `<div>`: update to `<div className="mb-1 flex items-center gap-2">`. Date on the left. On the right: mileage (if non-null), then `<Button variant="ghost" size="sm">Edit</Button>` and `<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Delete</Button>`.
- Clicking Edit calls `onEdit(entry)`; clicking Delete calls `onDelete(entry)`.

#### 2. Update OilChangeEntryList

**File**: `src/components/entries/OilChangeEntryList.tsx`

**Contract**: Same pattern as RepairEntryList. Props `{ entries, onEdit, onDelete }`. Edit/Delete buttons in card header.

#### 3. Update InspectionEntryList

**File**: `src/components/entries/InspectionEntryList.tsx`

**Contract**: Same pattern.

#### 4. Update InsuranceEntryList

**File**: `src/components/entries/InsuranceEntryList.tsx`

**Contract**: Same pattern.

#### 5. Update RepairEntries orchestrator

**File**: `src/components/entries/RepairEntries.tsx`

**Intent**: Add state for the active edit and delete targets, and render the `Dialog` (edit) and `AlertDialog` (delete) modals.

**Contract**:
- New state: `editingEntry: RepairEntry | null` (default null), `deletingEntry: RepairEntry | null` (default null), `isDeleting: boolean` (default false), `deleteError: string | null` (default null).
- Pass `onEdit={(e) => setEditingEntry(e)}` and `onDelete={(e) => setDeletingEntry(e)}` to `<RepairEntryList>`.
- **Edit Dialog**: `<Dialog open={editingEntry !== null} onOpenChange={(open) => { if (!open) setEditingEntry(null); }}>`. Inside `<DialogContent>`: `<DialogHeader><DialogTitle>Edit repair entry</DialogTitle></DialogHeader>` and `<RepairEntryEditForm entry={editingEntry!} onSuccess={(updated) => { setEntries(prev => prev.map(e => e.id === updated.id ? updated : e)); setEditingEntry(null); }} onCancel={() => setEditingEntry(null)} />`.
- **Delete AlertDialog**: `<AlertDialog open={deletingEntry !== null} onOpenChange={(open) => { if (!open && !isDeleting) setDeletingEntry(null); }}>`. Content: `<AlertDialogTitle>Delete entry</AlertDialogTitle><AlertDialogDescription>Delete repair entry from {new Date(deletingEntry!.conducted_at).toLocaleDateString()}? This cannot be undone.</AlertDialogDescription>`. Footer: `<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>` and `<AlertDialogAction disabled={isDeleting} onClick={handleDelete}>` where button text is `isDeleting ? "Deleting…" : "Delete"` with `className="bg-destructive ..."`.
- `handleDelete`: async function — set `isDeleting(true)`, `setDeleteError(null)`, call `DELETE /api/entries/repair?id=${deletingEntry.id}`, on 204: filter entry from list, setDeletingEntry(null); on error: `setDeleteError(json.error)`, keep dialog open.
- If `deleteError` is non-null, render it inside the AlertDialogContent.

#### 6. Update OilChangeEntries orchestrator

**File**: `src/components/entries/OilChangeEntries.tsx`

**Contract**: Same pattern as RepairEntries. Uses `OilChangeEntryEditForm`, calls `DELETE /api/entries/oil-change`.

#### 7. Update InspectionEntries orchestrator

**File**: `src/components/entries/InspectionEntries.tsx`

**Contract**: Same pattern. Uses `InspectionEntryEditForm`, calls `DELETE /api/entries/inspection`.

#### 8. Update InsuranceEntries orchestrator

**File**: `src/components/entries/InsuranceEntries.tsx`

**Contract**: Same pattern. Uses `InsuranceEntryEditForm`, calls `DELETE /api/entries/insurance`.

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- Entry cards show "Edit" and "Delete" buttons in the header row for all 4 tabs
- Clicking "Delete" opens the confirmation dialog showing the entry type and date
- Confirming delete removes the entry from the list; cancelling leaves it in place
- Deleting with a network error shows an error inside the still-open confirmation dialog
- Clicking "Edit" opens a pre-filled modal form for that entry type
- Editing and saving updates the entry in the list without a page reload
- The cancel button closes the edit modal without changes
- All behaviours work for all 4 entry types (Repairs, Oil Changes, Inspections, Insurance)

**Implementation Note**: This is the definition-of-done for S-05. Do not mark complete until all tab and action interactions are verified.

---

## Testing Strategy

### Manual Testing Steps

1. Start Supabase and dev server
2. Sign in, select a car, navigate to `/entries`
3. Add one entry of each type (Repairs, Oil Changes, Inspections, Insurance)
4. For each type: click Edit → modal opens pre-filled → change a field → Save → list updates in place
5. For each type: click Delete → confirmation dialog shows type + date → Cancel → entry stays → Delete → entry removed
6. Attempt delete with DevTools offline → error message appears in dialog, entry stays in list

## Migration Notes

None — no schema changes. All four tables already exist from F-02.

## References

- Roadmap S-05: `context/foundation/roadmap.md`
- PRD FR-008: `context/foundation/prd.md`
- Schema plan: `context/changes/entries-schema/plan.md`
- S-04 pattern: `context/changes/additional-entry-types/plan.md`
- Service pattern: `src/lib/services/entries.ts`
- API route pattern: `src/pages/api/entries/repair.ts`
- List pattern: `src/components/entries/RepairEntryList.tsx`
- Orchestrator pattern: `src/components/entries/RepairEntries.tsx`
- Delete dialog reference: `src/components/cars/DeleteCarDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service Functions + API Route PATCH/DELETE

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors — 3c17ed7
- [x] 1.2 `npm run build` passes with no TypeScript errors — 3c17ed7

#### Manual

- [x] 1.3 PATCH /api/entries/repair with valid body returns `{ entry }` 200 with updated fields — 3c17ed7
- [x] 1.4 DELETE /api/entries/repair?id=<uuid> returns 204 — 3c17ed7
- [x] 1.5 PATCH with non-existent entry id returns 404 — 3c17ed7
- [x] 1.6 DELETE without session returns 401 — 3c17ed7

### Phase 2: Edit Form Components + Install Dialog

#### Automated

- [x] 2.1 `npm run lint` passes — 20c9718
- [x] 2.2 `npm run build` passes with no TypeScript errors in new files — 20c9718

#### Manual

- [x] 2.3 Edit forms render without console errors (verified in Phase 3)

### Phase 3: List + Orchestrator Updates

#### Automated

- [x] 3.1 `npm run build` passes with no type errors — ecc9652

#### Manual

- [x] 3.2 Entry cards show Edit and Delete buttons for all 4 tabs — ecc9652
- [x] 3.3 Delete confirmation shows entry type and date; cancel leaves entry in list — ecc9652
- [x] 3.4 Confirmed delete removes entry from list for all 4 types — ecc9652
- [x] 3.5 Network error on delete shows error in still-open dialog — ecc9652
- [x] 3.6 Edit modal opens pre-filled for all 4 entry types — ecc9652
- [x] 3.7 Saving edit updates entry in-place in the list — ecc9652
- [x] 3.8 Cancel closes edit modal without changes — ecc9652
