---
change_id: cars-schema
roadmap_id: F-01
title: "Cars data schema — Supabase migration + RLS"
status: implemented
created: 2026-05-27
updated: 2026-05-27
implemented: 2026-05-27
prd_refs:
  - FR-002
  - FR-009
unlocks:
  - S-01 (car-management)
  - S-02 (ai-car-chat)
  - F-02 (entries-schema FK dependency)
prerequisites: []
---

## Summary

Foundation slice. Creates the `cars` PostgreSQL table in Supabase with all vehicle-identifying columns, a `engine_type` enum, row-level security (four per-operation policies restricting each user to their own rows), and a matching `Car` TypeScript type in `src/types.ts`.

No UI or API routes are part of this change — those belong to S-01 (car-management).
