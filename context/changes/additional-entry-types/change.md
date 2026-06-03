---
change_id: additional-entry-types
roadmap_id: S-04
title: "Additional entry types — oil change, inspection, and insurance entry logging"
status: impl_reviewed
created: 2026-06-02
updated: 2026-06-02
archived_at: null
prd_refs:
  - FR-005
  - FR-006
  - FR-007
unlocks:
  - S-05 (entry-management)
  - S-06 (deadline-dashboard)
prerequisites:
  - F-02 (entries-schema) — done
  - S-01 (car-management) — done
---

## Summary

S-04. Extends the `/entries` page from repair-only to all four entry types via a tabbed layout. Adds oil change (optional filter/parts details), technical inspection (result pass/fail, next due date), and insurance (insurer, policy period, renewal date) entry logging. The page becomes a `<EntriesTabs>` island with one tab per type; all four types share the same `/entries` route.

Edit/delete is out of scope — that is S-05.
