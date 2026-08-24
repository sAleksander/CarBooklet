---
change_id: ai-integration-scaffold
roadmap_id: F-03
title: "AI integration scaffold — OpenRouter + SSE streaming"
status: archived
created: 2026-06-01
updated: 2026-08-24
archived_at: 2026-08-24T15:43:57Z
prd_refs:
  - FR-010
  - FR-011
unlocks:
  - S-02 (ai-car-chat)
prerequisites: []
---

## Summary

Foundation slice. Wires the `openai` npm SDK (pointed at OpenRouter's free-tier API) to an auth-guarded Astro POST route that streams a server-sent events response using native `ReadableStream` (required by the Cloudflare Workers runtime). Adds a `useStreamingText` hook, a `StreamingText` display component, and a `ChatDemo` orchestration component. All three are exercised on a protected `/ai-test` page verified end-to-end under `wrangler dev`.

No car context or entry data is sent to the AI at this stage — that belongs to S-02. The scaffold proves the streaming transport works before S-02 wires real prompts.
