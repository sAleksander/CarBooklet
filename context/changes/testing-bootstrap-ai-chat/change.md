---
change_id: testing-bootstrap-ai-chat
title: Bootstrap test runner and prove the AI chat envelope (grounding + key non-leak)
status: implementing
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Bootstrap + AI chat envelope".
Risks covered: #1 (AI chat grounded in the wrong car / steered to a car the user does not own), #2 (OpenRouter API key / secrets leak into logs, error bodies, or the client bundle).
Test types planned: unit + integration.
Risk response intent:
- #1: prove the chat endpoint loads only the *owned* selected car; a foreign/selected id the user does not own resolves to nothing (e.g. 404), never to another user's car; the system prompt is built from that owned car's fields.
- #2: prove no error path, log line, or response body emits the OpenRouter key; the secret stays server-only.
This phase also bootstraps the test runner (Vitest) — the project currently has no test config or test deps.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
