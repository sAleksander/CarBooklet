# Follow-ups from the implementation review

Opened 2026-09-07 during triage of `reviews/impl-review.md`. Everything else in that
report is FIXED or ACCEPTED; these are the parts deliberately left out of the triage
commits, with the reason.

## 1. Bound car fields at the API boundary (F5, Fix B — the half not applied)

**What**: `carSchema` and `patchSchema` in `src/pages/api/cars/index.ts` and
`src/pages/api/cars/[id].ts` validate `brand`, `model`, `production_year`,
`engine_capacity`, `engine_power`, `engine_code`, `vin_number` with `.min(1)` and no
`.max()`. The columns are unbounded `TEXT`.

**Why it is still worth doing**: F5's Fix A now clips these to 200 characters _on the
way into the prompt_, so the LLM-cost and delimiter-forging problems are closed. What
remains is a storage question — a user can still persist a multi-megabyte "brand", and
every page that renders a car pays for it. Bounding at the boundary is the layer that
actually stops the row existing.

**Not urgent because**: nothing downstream is unbounded any more, and the change touches
two schemas plus `schemas.test.ts`'s generated table, which is wider than a review-triage
commit should reach.

## 2. Live-region role for the streaming answer (raised in `e2e/README.md`)

**What**: `src/components/ai/StreamingText.tsx` renders the streaming caret as
`<span className="animate-pulse">▋</span>` — no `role`, no `aria-live`, no accessible
name. A screen-reader user gets no signal that an answer is arriving.

**Why it was not done here**: a correct fix needs an announcement string ("Assistant is
responding…") in `en.json` and `pl.json`, and naive `aria-live="polite"` on the streamed
text re-announces the whole growing answer on every token. It needs a small design
decision, not a one-line edit — and the plan fixed the `aiChat` key list exactly, so it
was out of scope for both implementation and triage.

**Note**: `e2e/README.md` still documents this as an open blocker for the Phase 4 R6 flow,
which remains accurate.

## 3. Re-check the delete flow in a browser (consequence of F7)

F7 replaced N per-row delete islands with one delegated dialog. Manual verification item
4.10 ("Delete a thread from the list: confirm dialog, redirect to /ai-chat, thread gone")
was signed off against the _previous_ implementation and has not been re-run since.
Automated coverage does not reach this path — the list is `.astro` and there is no E2E for
`/ai-chat`.
