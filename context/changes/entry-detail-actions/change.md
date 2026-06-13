---
change_id: entry-detail-actions
title: Move edit/delete from entries list to the entry detail page
status: impl_reviewed
created: 2026-06-10
updated: 2026-06-10
archived_at: null
---

## Notes

Roadmap slice **S-05** (`context/foundation/roadmap.md`). Relocate the edit and delete
actions off the `/entries` list view and onto the `/entries/[id]` detail page introduced
by S-03 (entry-detail-route). After this change the list is purely navigational — click a
card to open its detail.

Prerequisite S-03 is shipped (done). Touches the live edit/delete mutation path, so the
destructive action must be re-tested end-to-end. Relocation only — keep the underlying
entry form and API routes unchanged (the "Redesigning add/edit entry forms" Parked item
stays parked).

Open at planning: current edit/delete wiring (inline buttons vs. row menu vs. modal) and
post-delete navigation + whether a confirm step is required.
