---
change_id: repair-entry-logging
roadmap_id: S-03
title: "Repair entry logging — view and add repair entries for selected car"
status: implementing
created: 2026-06-01
updated: 2026-06-01
prd_refs:
  - FR-003
unlocks:
  - S-05 (entry-management)
prerequisites:
  - F-02 (entries-schema) — done
  - S-01 (car-management) — done
---

## Summary

S-03. Adds a `/entries` page where a logged-in user can view existing repair entries for their selected car and add new ones via a persistent form. The form clears after a successful submit and the new entry appears at the top of the list. Navigating to `/entries` with no selected car redirects to `/cars`.

No edit/delete in this slice — that is S-05. No other entry types — that is S-04.
