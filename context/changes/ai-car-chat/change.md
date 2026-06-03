---
change_id: ai-car-chat
roadmap_id: S-02
title: "AI car chat — stream model-aware AI responses for the selected car"
status: impl_reviewed
created: 2026-06-02
updated: 2026-06-02
archived_at: null
review: context/changes/ai-car-chat/reviews/impl-review.md
prd_refs:
  - US-01
  - FR-010
  - FR-011
unlocks:
  - S-04 addendum (entry context in AI prompt)
prerequisites:
  - F-01 (cars-schema) — done
  - F-03 (ai-integration-scaffold) — done
  - S-01 (car-management) — done
---

## Summary

S-02 (north star). Wires the car's make, model, year, and non-null engine details into the AI system prompt so the LLM responds with model-specific knowledge rather than generic car advice. Adds a production `/ai-chat` page reachable from the Topbar. Deletes the `/ai-test` dev scaffold.

No entry context in this slice — that is an S-02 addendum deferred until S-03/S-04 populate the entries table.
