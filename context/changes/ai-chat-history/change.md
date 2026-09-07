---
change_id: ai-chat-history
title: Multi-turn AI chat — conversation history instead of one-shot Q&A
status: impl_reviewed
created: 2026-09-02
updated: 2026-09-07
archived_at: null
---

## Notes

Currently when user sends question he gets reply and thats it. If he sends
another one previous one is lost. Currently users are acustomed to a chat bots
and this should behave like one so conversation prompt - reply and history.

## Phase 5 findings (2026-09-07)

### OpenRouter experiment (a) — does `GET /v1/key` expose the daily request cap?

**No.** The endpoint reports _dollar_ usage and limits, which are all zero for a
free-tier key spending only free models:

```
is_free_tier:    true
limit:           0        limit_remaining: 0
usage:           0        usage_daily:     0
rate_limit:      { requests: -1, interval: "10s", note: "deprecated and safe to ignore" }
```

`is_free_tier: true` confirms the account is below the $10 lifetime-credits
threshold, which is the condition under which the **50 requests/day** cap applies
rather than 1000/day. But there is no remaining-request counter here to read, and
the one `rate_limit` field present is self-described as deprecated.

**Consequence**: the 429 log line the chat route now emits — one flat `api_error`
object carrying `x-ratelimit-remaining` / `x-ratelimit-reset` off `APIError.headers`
— is the _only_ observability on the cap. Polling `/v1/key` as a pre-flight budget
check is not an option. Recorded in `test-plan.md` §7.

### OpenRouter experiment (b) — is `session_id` sticky on `openrouter/free`?

**No.** Two consecutive non-streaming requests, same `session_id`, ~1s apart:

```
request 1 → liquid/lfm-2.5-2.6b:free
request 2 → minimax/minimax-m3:free
```

The plan hedged this deliberately ("documented for the Auto and Pareto routers and
not specifically for the free one, so this is a cheap bet rather than a guarantee").
The bet did not pay off: the free router re-picks per request regardless.

**Consequence**: persona whiplash _within_ a thread is real and unmitigated — turn 3
can be answered by a different model than turn 2. Two things already in place limit
the damage: the system prompt is re-sent every turn, and the resolved model is stored
per message (`messages.model`), so the drift is measurable rather than merely
suspected. `session_id` is left in the request body — it costs nothing and is
correct if OpenRouter extends stickiness to the free router — but **model pinning is
now the evidence-backed option** whenever thread-level consistency matters more than
the free router's availability spread. That decision is deliberately not taken here.

Cost: 2 requests from the 50/day cap.

### Bundle size

Measured with `npm run build && npx wrangler deploy --dry-run --outdir dist-check`;
the baseline was built from a clean worktree at `935f979` (the commit before p1).

|                    | raw         | gzipped                  | modules |
| ------------------ | ----------- | ------------------------ | ------- |
| before (`935f979`) | 2799.24 KiB | **557.82 KiB**           | 50      |
| after (`13da8e3`)  | 3267.23 KiB | **657.97 KiB**           | 56      |
| delta              | +467.99 KiB | **+100.15 KiB (+18.0%)** | +6      |

Well inside the 3 MB gzipped Worker limit — 657.97 KiB is ~21% of it. The increase is
essentially all `react-markdown` + `remark-gfm` and their unified/micromark chain,
which the Worker carries because the transcript island is server-rendered before it
hydrates. Worth revisiting only if the limit comes into view; a lighter renderer
would be the lever.
