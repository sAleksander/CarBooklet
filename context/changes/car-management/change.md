---
change_id: car-management
roadmap_id: S-01
title: "Car management — add, view, edit, remove, select"
status: implemented
created: 2026-05-27
updated: 2026-05-27
prd_refs:
  - FR-001
  - FR-002
  - FR-009
unlocks:
  - S-02 (ai-car-chat)
  - S-03 (repair-entry-logging)
  - S-04 (additional-entry-types)
prerequisites:
  - F-01 (cars-schema) — done
---

## Summary

User-facing slice. Full CRUD for cars: add, view, edit, and remove cars from a dedicated `/cars` page. Supports multiple cars with a visible selected-car indicator. Establishes the `selected_car_id` cookie as the cross-slice selected-car contract consumed by S-02 through S-06.

No AI chat, no entry logging — those belong to S-02 and S-03/S-04.
