# Move Edit/Delete to the Entry Detail Page — Plan Brief

> Full plan: `context/changes/entry-detail-actions/plan.md`

## What & Why

Move the Edit and Delete actions off the `/entries` list cards and onto the entry detail page (`/entries/[type]/[id]`, built in S-03). One place manages an entry's lifecycle; the list becomes purely navigational (click a card → open detail). Roadmap slice **S-05**.

## Starting Point

The detail page is read-only SSR Astro with no React island. Edit lives as a modal `Dialog` + reusable `*EntryEditForm` and Delete as a confirm `AlertDialog` + `DELETE` fetch — both owned by the four `*Entries.tsx` orchestrators and triggered by two ghost buttons on each `*EntryList.tsx` card. The edit forms are self-contained (own their PATCH) and reusable; the API endpoints already exist.

## Desired End State

The detail page gains a footer action bar with Edit and Delete. Edit swaps the read-only fields for that type's form in place; saving reloads the page to show the new values. Delete confirms, deletes, and returns to `/entries`. The list tabs still create and list entries and navigate on click — but carry no Edit/Delete buttons, and the orchestrators no longer carry edit/delete code.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Edit UX on detail page | Inline, replace read view | User wanted editing in place rather than a modal | Plan |
| Read view during edit | Astro view passed as island children, swapped for form | Keeps `EntryDetail.astro` the single render source — no React duplication | Plan |
| After successful edit | `window.location.reload()` | SSR re-renders fresh fields; no client-side patch logic | Plan |
| After successful delete | Redirect to `/entries` | Entry is gone; return to its list is the natural continuation | Plan |
| Action placement | Footer action bar | Clear content-vs-actions separation on the detail card | Plan |
| Delete confirmation | Keep the existing `AlertDialog` | Guards an irreversible action; reuses a proven pattern | Plan |
| List-side cleanup | Remove entirely (buttons + orchestrator code) | No dead code; orchestrators shrink to create-form + list | Plan |

## Scope

**In scope:** new `EntryDetailEditor.tsx` island (inline edit + confirmed delete) for all 4 types; mounting it on `[type]/[id].astro`; removing Edit/Delete from the 4 list components and 4 orchestrators.

**Out of scope:** DB/API/middleware changes; redesigning the edit forms; entry creation; list tab structure and card content; edit/delete anywhere other than the detail page.

## Architecture / Approach

The detail page renders `EntryDetail.astro` (read view) as **children** of a new `EntryDetailEditor` React island (`client:load`). The island shows the children + a footer Edit/Delete bar in read mode; on Edit it narrows the `Entry` discriminated union to render the matching existing `*EntryEditForm` in place, reloading on save. Delete reuses the orchestrators' confirm-dialog + `DELETE /api/entries/<slug>?id=` pattern (with an `oil_change → oil-change` slug map), redirecting to `/entries` on HTTP 204. Phase 2 then deletes the relocated code from the list side.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Detail-page actions island | Inline edit + confirmed delete on the detail page, wired into the route | Astro-children-into-React-island toggle behaving correctly; correct API slug for oil change |
| 2. Strip edit/delete from list side | Buttons gone from 4 lists; edit/delete state gone from 4 orchestrators | Leftover unused imports/props (caught by lint) |

**Prerequisites:** S-03 (entry detail route) — shipped. No new deps.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes Astro passes the rendered `EntryDetail.astro` output as static children to the React island and that toggling `{children}` ↔ form works (standard Astro islands behavior; verify on first run).
- Assumes all 4 `*EntryEditForm` components share the `{ entry, onSuccess(updated), onCancel }` contract (confirmed for repair; verify the other 3 during Phase 1).
- Phase 1 leaves edit/delete temporarily available in both places — intended until Phase 2 lands.

## Success Criteria (Summary)

- From any entry's detail page, the user can edit a field inline and see it persisted, and delete the entry and land back on `/entries`.
- The entry list no longer shows Edit/Delete buttons but still navigates to detail on click, and creating entries still works.
- `npm run lint` and `npm run build` pass with no dead code left behind.
