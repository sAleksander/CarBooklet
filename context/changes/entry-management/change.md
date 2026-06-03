---
change_id: entry-management
roadmap_id: S-05
title: "Entry management — edit and delete all entry types with delete confirmation"
status: implemented
created: 2026-06-03
updated: 2026-06-03
prd_refs:
  - FR-008
unlocks:
  - S-06 (deadline-dashboard)
prerequisites:
  - F-02 (entries-schema) — done
  - S-03 (repair-entry-logging) — done
  - S-04 (additional-entry-types) — done
---

## Summary

S-05. Adds edit and delete (with confirmation dialog) to all four entry types on the `/entries` page. Each entry card gets Edit and Delete buttons in its header row. Delete opens an `AlertDialog` confirmation showing the entry type and date. Edit opens a `Dialog` modal pre-populated with entry data; submitting sends a PATCH request and updates the entry in the list. Deletion is wait-for-server.

No create flow changes — that remains in the existing add-form above each tab's list.
