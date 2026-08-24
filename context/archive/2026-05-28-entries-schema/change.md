---
change_id: entries-schema
roadmap_id: F-02
title: "Entries data schema — Supabase migration + RLS"
status: archived
created: 2026-05-28
updated: 2026-08-24
archived_at: 2026-08-24T15:46:24Z
prd_refs:
  - FR-003
  - FR-005
  - FR-006
  - FR-007
  - FR-008
unlocks:
  - S-03 (repair-entry-logging)
  - S-04 (additional-entry-types)
  - S-05 (entry-management)
prerequisites:
  - F-01 (cars-schema)
---

## Summary

Foundation slice. Creates four separate PostgreSQL entry tables — `repair_entries`, `oil_change_entries`, `inspection_entries`, `insurance_entries` — each with a user-backdatable `conducted_at` date, optional `mileage`, `user_id` FK for RLS, `car_id` FK to cars, and type-specific columns. Enables all PRD entry-logging and entry-management features, and provides the dashboard-critical date columns (`next_inspection_date`, `renewal_date`) that FR-012 will query.

No UI or API routes are part of this change — those belong to S-03, S-04, and S-05.
