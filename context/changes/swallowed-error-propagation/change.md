---
change_id: swallowed-error-propagation
title: Propagate swallowed errors at the API and SSR boundary
status: planned
created: 2026-08-24
updated: 2026-08-24
archived_at: null
---

## Notes

Seeded from an audit of every `catch` site in `src/` (Module 3 exercise: find a
try/catch that swallows an exception instead of propagating it to the API
response, then fix propagation + handling).

**Wording caveat.** The exercise describes "catches, logs, does not propagate".
No such site exists here: `grep -rn "console\." src` returns exactly two hits —
`src/pages/api/ai/chat.ts:48` and `:66` — and both _do_ propagate (a 500 body,
and an SSE `error` event that `useStreamingText` reads into `setError`). The
project has the harsher variant instead: swallows that do not even log.

### Finding 1 (primary) — infrastructure fault downgraded to 404, no trace

- `src/pages/api/cars/[id].ts:48` (PATCH)
- `src/pages/api/cars/[id].ts:91` (DELETE)
- `src/pages/api/cars/[id]/select.ts:23` (POST)

```ts
const existing = await getCarById(supabase, id, user.id).catch(() => null);
if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
```

`getCarById` (`src/lib/services/cars.ts:10`) already returns `null` for "no such
row owned by this user" (`PGRST116`). So `.catch(() => null)` catches _only_
genuine faults — connection failure, RLS misconfiguration, statement timeout,
`22P02 invalid input syntax for type uuid` — and answers every one of them with
`404 {"error":"Not found"}` and zero server-side trace. A dead database reads to
the user as "your car does not exist".

Test-plan tie-in: this sits directly on R3's path. An integration test asserting
404 for a foreign car id passes both when ownership is correctly enforced _and_
when the DB is broken — the swallow drains the signal out of the very isolation
test rollout Phase 2 (`data-isolation-crud-integrity`) is about to write.

Fix shape: split the two outcomes — `try/catch` → log + 500 for the throw,
`if (!car)` → 404 for the null. Add `z.uuid()` on the path param so a malformed
id stays 4xx rather than becoming a newly-surfaced 500.

### Finding 2 — SSR page swallows, invisible to server and user alike

`src/pages/dashboard.astro:32`, `src/pages/entries.astro:30` and `:47`,
`src/pages/entries/[type]/[id].astro:28` and `:43`:

```ts
} catch {
  return Astro.redirect("/cars?error=load_failed");
}
```

Nothing logged, and `grep -rn "load_failed" src/` confirms no page ever _reads_
`error=load_failed` — `/cars` ignores the query string. The user is silently
bounced to the garage with no explanation. Not an API response, so secondary to
Finding 1, but the same defect class.

### Finding 3 — the mirror defect: over-propagation, still no log

14 sites in `src/pages/api/cars/index.ts` and
`src/pages/api/entries/{repair,oil-change,inspection,insurance}.ts`:

```ts
} catch (err) {
  return Response.json({ error: (err as Error).message }, { status: 500 });
}
```

Raw Postgres text — table, column, constraint and RLS-policy names — echoed to
the client, and nothing written server-side. This is test-plan §2 R2 (internal
detail / secret leakage) territory. Decide during planning whether it belongs in
this change or its own.

### Scope question for planning

Whether to ship Finding 1 alone (matches the exercise exactly, smallest diff) or
all three (coherent error-handling boundary, ~20 sites across 8 files). Findings
2 and 3 change response bodies and page output; no existing test asserts those
strings — the four unit tests under `src/test/` are all AI-related, and the three
e2e specs exercise only owner-happy-path and 404-for-foreign-id, both preserved
by the Finding 1 fix.

---

### For `/10x-research` — what to ground before planning

Findings above are a _symptom inventory_ produced by grepping every `catch` in
`src/`. They name where the swallows are, not what the correct answer at each
boundary is. Research must decide the latter. Suggested decomposition (one
sub-agent per area):

**Area 1 — What each caught exception can actually be.**
Enumerate the real failure modes reaching these catches, not the hypothetical
ones. Start at `src/lib/services/cars.ts` and `src/lib/services/entries.ts`:
every service function follows `if (res.error) throw new Error(res.error.message)`,
so the thrown value is always a flat `Error` carrying a PostgREST message —
`res.error.code`, `.details`, `.hint` are discarded at the throw site. Determine
which PostgREST/Postgres codes can surface per operation (`PGRST116` no-rows,
`23505` unique violation, `23502` not-null, `23503` FK, `22P02` malformed uuid,
`42501` RLS denial, timeouts, network faults). That set decides the correct
status code per catch and whether `cars.ts:10-17`'s `PGRST116`-only special case
is the right shape or should generalize.

**Area 2 — The existing error-handling contract, and who depends on it.**
There is no shared error helper today; each route hand-rolls its response. Map
the de-facto contract: which shapes exist (`{error: string}` vs `204` vs
`{success: true}`), and which clients read them —
`src/components/cars/CarList.tsx`, the eight `src/components/entries/*Form.tsx`
components, `src/components/hooks/useStreamingText.ts`,
`src/components/ai/ChatDemo.tsx`. Several do `json.error ?? t("common.anErrorOccurred")`,
so changing a 500 body to a generic string is user-visible. Also check
`src/i18n/locales/{en,pl}.json` — user-facing error text is translated, raw
Postgres text is not, which is an argument in itself.

**Area 3 — Prior decisions and the house pattern.**
`src/pages/api/ai/chat.ts` is the only route that logs, and Phase 1
(`context/changes/testing-bootstrap-ai-chat/`) is the only change that
deliberately reasoned about the error envelope — it produced the
`console.error` + generic-body pattern at `chat.ts:46-50`, and
`src/test/pages/api/ai/chat.test.ts` asserts against it. Establish whether that
is the intended house pattern to propagate, and what those tests already lock
in. Also check `context/foundation/lessons.md` if present.

**Area 4 — Observability reality on the target runtime.**
The app deploys to Cloudflare Workers (`wrangler.jsonc`, `astro.config.mjs`).
Before prescribing `console.error` everywhere, confirm where those lines
actually go in production and whether anything consumes them — a fix whose only
output is a log nobody reads is not a fix. This is the one area that may need
external docs rather than codebase grep.

**Assumptions to challenge** (in the test-plan §2 style):

- "A 404 is a safe default when a lookup fails." It is not: it is
  indistinguishable from the authorization answer, which is exactly what R3's
  tests assert on.
- "`(err as Error).message` is a safe thing to return." The cast is unchecked
  and the content is Postgres-authored.
- "Logging is enough." Findings 2 and 3 each fix only half the problem; the
  question is what the _user_ is owed on failure, separately from the operator.
- "Every catch should become a 500." Some of these faults are genuinely 4xx
  (`22P02` malformed uuid, `23505` duplicate) and collapsing them all to 500 is
  a different flavor of the same conflation.

**Explicitly out of scope for research** — do not re-derive the symptom
inventory; the file:line list above is verified as of commit `a7c9102`. Also do
not research the AI/streaming error path (`chat.ts:54-73`): it logs _and_
propagates an SSE `error` event, and Phase 1 already covered it.

**What planning needs back:** a per-boundary decision table — for each catch
site, the correct status code, the response body the client is allowed to see,
what gets logged, and whether the split belongs in the route or in the service
layer.
