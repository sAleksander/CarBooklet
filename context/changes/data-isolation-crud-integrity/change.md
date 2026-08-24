---
change_id: data-isolation-crud-integrity
title: Data isolation + CRUD integrity tests — cross-user IDOR (R3) and server-side validation (R5)
status: implementing
created: 2026-06-15
updated: 2026-08-24
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: prove cross-user data isolation (R3 IDOR) and CRUD integrity + server-side validation (R5) on car/entry API routes, tested against a local Supabase stack with RLS (not mocked).

Risks covered:

- #3 (cross-user data access / IDOR): a user must not read, edit, or delete another user's car or entry by id. Exercise a second user against the real per-query `user_id` filter + RLS — do not trust RLS without a second-user test, do not test only the owner's happy path.
- #5 (entry/car CRUD regression + server-side validation): create/edit/delete enforce ownership and server-side validation (mileage check, not-null constraints) regardless of client input. Oracle is the DB constraint, never copied from the handler under test; do not over-mock the DB so constraints never fire.

Test type: integration against local Supabase (`npx supabase start`, Docker + RLS). This is the deliberate departure from Phase 1's boundary-mock pattern (test-plan §1 cost×signal, §4 stack, §6.3 cookbook).

Phase 1 (testing-bootstrap-ai-chat) established the runner + cookbook §6.1/§6.2; this phase fills §6.3 (Supabase isolation) and extends §6.2 with car/entry routes.

Downstream: this change needs codebase grounding before planning (which routes exist, how ownership is enforced per operation, RLS policy state) — suggest /10x-research next.
