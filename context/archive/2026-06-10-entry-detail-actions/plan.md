# Move Edit/Delete to the Entry Detail Page Implementation Plan

## Overview

Relocate the Edit and Delete actions off the four `/entries` list cards and onto the entry detail page (`/entries/[type]/[id]`). Edit becomes an **inline** form that replaces the read-only view in place; Delete keeps its confirmation dialog and, on success, returns the user to `/entries`. After this change the entry list is purely navigational — a card click opens the detail page, which is now the single place an entry's lifecycle is managed. This is roadmap slice **S-05**. No database, API, or middleware changes.

## Current State Analysis

- **The detail page is read-only SSR Astro with no React island.** `src/pages/entries/[type]/[id].astro` guards auth/car-scope, 404s on miss, and renders `EntryDetail.astro` (a non-interactive switch on `entry.entry_type`). It has a `← Back to entries` link in the header.
- **Edit forms are already self-contained and reusable.** Each `*EntryEditForm.tsx` owns its `PATCH /api/entries/<slug>` fetch, its own validation/loading/error state, and exposes exactly `{ entry, onSuccess(updated), onCancel }` (`src/components/entries/RepairEntryEditForm.tsx:8-14,43`). They can be mounted anywhere without the orchestrator.
- **Delete logic lives in the orchestrators, not the lists.** Each `*Entries.tsx` owns the delete `AlertDialog`, the `isDeleting`/`deleteError`/`deletingEntry` state, and the `DELETE /api/entries/<slug>?id=<id>` fetch that treats `status === 204` as success (`src/components/entries/RepairEntries.tsx:27-54,100-133`). It also owns the edit `Dialog` wrapping the edit form (`RepairEntries.tsx:75-98`).
- **List components only emit callbacks.** Each `*EntryList.tsx` renders a card as `<a href="/entries/<type>/<id>">` with two ghost `Button`s that call `e.stopPropagation(); e.preventDefault(); onEdit/onDelete(entry)` (`src/components/entries/RepairEntryList.tsx:19-60`). Removing the buttons leaves a clean navigational card.
- **`Entry` is a discriminated union on `entry_type`.** One component can `switch`/narrow on `entry.entry_type` to choose the right edit form, exactly as `EntryDetail.astro` already narrows for rendering.
- **Route slug vs API slug differ for oil change.** Page route uses the underscore `entry_type` (`/entries/oil_change/[id]`); the API route file is hyphenated (`src/pages/api/entries/oil-change.ts`). The detail link in the lists already uses `entry.entry_type` verbatim. The actions island needs an explicit `entry_type → api-slug` map so DELETE hits the right endpoint.
- **Four entry types, uniform shape:** `repair`, `oil_change`, `inspection`, `insurance`, each with a matching `*Entries.tsx`, `*EntryList.tsx`, `*EntryEditForm.tsx`, and `api/entries/<slug>.ts`.

## Desired End State

On `/entries/[type]/[id]`, a footer action bar shows **Edit** and **Delete**. Clicking **Edit** swaps the read-only fields for that entry type's edit form in place; saving persists via the existing PATCH endpoint and reloads the page so the SSR read view shows the new values; Cancel returns to the read view. Clicking **Delete** opens the existing confirm dialog; confirming deletes via the existing DELETE endpoint and redirects to `/entries`. The four `/entries` list tabs still create and list entries, and each card still navigates to its detail page — but the cards no longer carry Edit/Delete buttons, and the orchestrators no longer carry edit/delete code.

Verify: from a detail page of each of the 4 types, inline-edit a field → save → reloaded page shows the change; Cancel restores the read view; Delete → confirm → land on `/entries` with the entry gone; the list cards show no Edit/Delete buttons but still open detail on click; creating an entry from the list still works.

### Key Discoveries:

- Edit forms are reuse-ready with a uniform `{ entry, onSuccess, onCancel }` contract — `src/components/entries/RepairEntryEditForm.tsx:8-14`.
- Delete is `DELETE /api/entries/<slug>?id=<id>`, success = HTTP 204 — `src/components/entries/RepairEntries.tsx:41-43`.
- Astro can pass the rendered `EntryDetail.astro` output as **children** into a React island; the island renders `{children}` for the read view and swaps to the form when editing — no need to re-implement the read render in React.
- `oil_change` (route) maps to `oil-change` (API) — the only non-identity entry in the slug map.
- Detail page already 404s before render for missing/foreign entries, so the island never mounts for an entry the user can't access.

## What We're NOT Doing

- No DB schema changes, no migrations.
- No API route changes — the existing PATCH and DELETE endpoints for all 4 types are reused verbatim.
- No middleware changes — `/entries/**` is already guarded.
- No redesign of the edit forms or their fields — they are reused exactly as-is (the "Redesigning add/edit entry forms" item stays parked).
- No change to entry creation — the "Log a …" create forms and the optimistic prepend stay in the orchestrators.
- No change to the list's tab structure, card content/summary, or the click-to-navigate behavior — only the two action buttons are removed.
- No edit/delete on the dashboard last-entry widget or anywhere else — detail page only.

## Implementation Approach

Two phases, additive-then-subtractive. Phase 1 adds the full edit/delete capability to the detail page via one new React island (`EntryDetailEditor.tsx`) that wraps the existing Astro read view as children and reuses the existing edit forms and API endpoints. Phase 2 removes the now-duplicated capability from the four list components and four orchestrators. Sequencing Phase 1 first guarantees there is never a moment where an entry can be neither edited nor deleted.

## Critical Implementation Details

- **Astro-children-into-island toggle.** The island must receive the read view as Astro children (`<EntryDetailEditor ... client:load><EntryDetail entry={entry} /></EntryDetailEditor>`) and render `{!editing ? children : <Form/>}`. The children arrive as static pre-rendered HTML — correct, since the read view is non-interactive. Do **not** re-implement the field rendering in React; that would duplicate `EntryDetail.astro` and risk drift.
- **Slug map is load-bearing.** `oil_change → oil-change`; all others are identity. A wrong slug sends DELETE to a non-existent route. Derive the map once in the island.
- **Success signals already differ by verb.** PATCH returns `{ entry }` with `res.ok`; DELETE returns bare HTTP `204`. Mirror the existing checks (`RepairEntryEditForm.tsx:55`, `RepairEntries.tsx:42`) rather than assuming a uniform JSON envelope.
- **Post-edit is a hard reload, not a client patch** (per decision) — on the edit form's `onSuccess`, call `window.location.reload()`. The returned updated entry is ignored; SSR is the source of truth.

## Phase 1: Detail-page actions island

### Overview

Add one React island that hosts the footer Edit/Delete bar, the inline (replace-in-place) edit form, and the delete confirmation — then mount it on the detail page wrapping the existing read view.

### Changes Required:

#### 1. Entry detail actions island

**File**: `src/components/entries/EntryDetailEditor.tsx` (new)

**Intent**: Provide inline edit + confirmed delete for a single entry on the detail page, reusing the existing per-type edit forms and the existing PATCH/DELETE endpoints. Holds the editing toggle, renders the Astro read view (passed as children) when not editing, and the correct edit form when editing.

**Contract**: A React component, props `{ entry: Entry; children: React.ReactNode }`.

- State: `editing: boolean`, plus delete state mirroring the orchestrator (`confirmOpen`/`deletingError`/`isDeleting`).
- **Read mode** (`!editing`): render `{children}` (the Astro read view) followed by a footer action bar (separated by the existing `hr` glass style) with an **Edit** button (`onClick → setEditing(true)`) and a destructive **Delete** button (`onClick → open confirm dialog`).
- **Edit mode** (`editing`): narrow on `entry.entry_type` and render the matching form — `repair → RepairEntryEditForm`, `oil_change → OilChangeEntryEditForm`, `inspection → InspectionEntryEditForm`, `insurance → InsuranceEntryEditForm` — passing `entry={entry}`, `onSuccess={() => window.location.reload()}`, `onCancel={() => setEditing(false)}`. The discriminated union narrows each branch so the typed `entry` matches each form's prop type.
- **Delete**: reuse the `AlertDialog` pattern from `RepairEntries.tsx:100-133` (title "Delete entry", "This cannot be undone.", Cancel + destructive Delete, disabled while in flight, inline error on failure). On confirm, `fetch(\`/api/entries/${slug(entry.entry_type)}?id=${entry.id}\`, { method: "DELETE" })`; on `res.status === 204`→`window.location.href = "/entries"`; otherwise surface `json.error`.
- **Slug map**: `const API_SLUG: Record<Entry["entry_type"], string> = { repair: "repair", oil_change: "oil-change", inspection: "inspection", insurance: "insurance" }`.

Per `CLAUDE.md` this is interactive → React, lives in `src/components/`, uses `cn()` for any class merging, no `"use client"` directive.

#### 2. Mount the island on the detail page

**File**: `src/pages/entries/[type]/[id].astro`

**Intent**: Wrap the read view in the new island so the detail page gains inline edit + delete, without disturbing the auth/car-scope guard or the not-found branch.

**Contract**: In the `entry` (found) branch only, replace `<EntryDetail entry={entry} />` (`[id].astro:87`) with `<EntryDetailEditor entry={entry} client:load><EntryDetail entry={entry} /></EntryDetailEditor>`. Import the island at the top. The not-found branch (`[id].astro:59-69`), the header/back link, and all server logic are unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- On a detail page for each of the 4 entry types, the footer shows Edit and Delete.
- Clicking Edit replaces the read-only fields with that type's edit form, pre-filled with current values.
- Saving a change persists and the reloaded page shows the new value(s); `updated_at` footer reflects the edit.
- Cancel returns to the read view without changes.
- Clicking Delete shows the confirm dialog; confirming deletes the entry and lands on `/entries` with the entry no longer listed.
- Cancelling the delete dialog leaves the entry intact on the detail page.
- A failed delete (e.g. simulated) shows an inline error and stays on the page.
- The page still renders inside `AppLayout` on desktop and mobile; logged-out access still redirects to `/auth/signin`.

**Implementation Note**: After Phase 1 automated checks pass, pause for manual confirmation before Phase 2. At this point edit/delete works in BOTH places (detail page and list) — that's expected and temporary.

---

## Phase 2: Strip edit/delete from the list side

### Overview

Remove the Edit/Delete buttons from the four list components and the now-dead edit `Dialog` / delete `AlertDialog` and associated state from the four orchestrators, leaving create-form + navigational list.

### Changes Required:

#### 1. Remove action buttons from the list components (×4)

**File**: `src/components/entries/RepairEntryList.tsx`, `OilChangeEntryList.tsx`, `InspectionEntryList.tsx`, `InsuranceEntryList.tsx`

**Intent**: Make each card purely navigational — keep the `<a>` to the detail page and all summary content, remove the two ghost buttons and their wrapper.

**Contract**: Drop the `onEdit`/`onDelete` props from each component's props interface and signature. Remove the Edit and Delete `<Button>`s and the flex `div` that grouped them (`RepairEntryList.tsx:29-51` and equivalents); keep the mileage/summary span and the rest of the card markup. Remove the now-unused `Button` import. The `<a href="/entries/<type>/<id>">` wrapper and hover affordance stay.

#### 2. Remove edit/delete from the orchestrators (×4)

**File**: `src/components/entries/RepairEntries.tsx`, `OilChangeEntries.tsx`, `InspectionEntries.tsx`, `InsuranceEntries.tsx`

**Intent**: Shed the relocated capability — orchestrators keep `entries` state, the create form, and the list; everything edit/delete goes.

**Contract**: In each orchestrator remove: `editingEntry`/`deletingEntry`/`isDeleting`/`deleteError` state, the `handleDelete` function, the edit `<Dialog>` block, the delete `<AlertDialog>` block, and the `onEdit`/`onDelete` props passed to the list (the list now takes neither). Remove the now-unused imports (`Dialog*`, `AlertDialog*`, `*EntryEditForm`). Keep `entries`/`setEntries`, `formKey`, `handleSuccess`, the create form, and `<*EntryList entries={entries} />`. The `*EntryEditForm` import moves to the island (Phase 1) — it should no longer be referenced here.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint` (also catches any unused imports/props left behind)
- Build succeeds: `npm run build`

#### Manual Verification:

- The 4 list tabs show no Edit/Delete buttons on any card.
- Clicking a card still opens its detail page.
- Creating a new entry from each tab still works and prepends to the list.
- Edit/Delete now work only from the detail page (Phase 1), and there are no console errors on the list view.

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation, then run the regression smoke check below.

---

## Testing Strategy

### Manual Testing Steps:

1. For each of the 4 types: open a card → detail page → Edit → change a field → Save → confirm the reloaded page shows the change.
2. For a repair entry, edit the multi-line `description` → confirm line breaks persist and render on the read view.
3. Edit → Cancel → confirm the read view is unchanged.
4. Delete from the detail page → confirm dialog → Delete → land on `/entries`, entry gone from the list.
5. Open the delete dialog → Cancel → entry still present.
6. Confirm the list cards (all 4 tabs) have no Edit/Delete buttons but still navigate on click.
7. Create a new entry in each tab → still works, prepends to the list.
8. Regression (PRD guardrail `FR-007`): car CRUD on `/cars` unaffected; logged-out `/entries/[type]/[id]` redirects to `/auth/signin`.

## Migration Notes

None — no data or schema changes.

## Addenda

- **p2 — `src/components/ui/button.tsx`** (unplanned, surfaced in manual testing): added `text-foreground` to the `outline` Button variant. The edit-form Cancel button was rendering white-on-white inside the detail page's `text-white` glass card. Fix-at-source aligning with canonical shadcn; spot-checked the other 7 `outline` call sites (CarList, dialog Close, edit-form Cancels) — none regress.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- Prior slice this builds on: `context/changes/entry-detail-route/plan.md` (S-03)
- Reusable edit form contract: `src/components/entries/RepairEntryEditForm.tsx:8-14,43`
- Delete fetch + confirm pattern to port: `src/components/entries/RepairEntries.tsx:36-54,100-133`
- Detail page + read render: `src/pages/entries/[type]/[id].astro:87`, `src/components/entries/EntryDetail.astro`
- API endpoints (unchanged): `src/pages/api/entries/{repair,oil-change,inspection,insurance}.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Detail-page actions island

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — 8523829
- [x] 1.2 Build succeeds: `npm run build` — 8523829

#### Manual

- [x] 1.3 Footer shows Edit + Delete on all 4 entry types — 8523829
- [x] 1.4 Edit replaces read view with the pre-filled type-specific form — 8523829
- [x] 1.5 Saving persists and the reloaded page shows the new values (updated_at reflects edit) — 8523829
- [x] 1.6 Cancel returns to the read view unchanged — 8523829
- [x] 1.7 Delete → confirm → lands on /entries with the entry removed — 8523829
- [x] 1.8 Cancelling the delete dialog leaves the entry intact — 8523829
- [x] 1.9 Failed delete shows inline error and stays on the page — 8523829
- [x] 1.10 Renders in AppLayout desktop + mobile; logged-out redirects to /auth/signin — 8523829

### Phase 2: Strip edit/delete from the list side

#### Automated

- [x] 2.1 Type checking passes: `npm run lint` — 3887180
- [x] 2.2 Build succeeds: `npm run build` — 3887180

#### Manual

- [x] 2.3 No Edit/Delete buttons on any list card (all 4 tabs) — 3887180
- [x] 2.4 Clicking a card still opens its detail page — 3887180
- [x] 2.5 Creating an entry from each tab still works and prepends to the list — 3887180
- [x] 2.6 No console errors on the list view — 3887180
