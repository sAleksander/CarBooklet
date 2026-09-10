# Follow-ups from the implementation review (2026-09-10)

Ten findings were raised in `reviews/impl-review.md`; all ten were triaged and
fixed. This file records the two things a fix could not carry on its own.

## 1. How the manual Progress rows were actually verified (F8)

Rows 5.6-5.7, 6.11-6.12 and 7.9-7.17 are checked, but the evidence is not in the
diff. They were verified with throwaway Playwright specs (`e2e/zz-scratch-*.spec.ts`)
run against a real browser and a real local Supabase, then deleted. The runs
happened and their output was read; nothing in the repository proves it. Recorded
here so the claim is auditable rather than taken on trust.

**5.6 / 5.7 — F10 copy in both locales.** A spec stubbed `POST /api/cars` with a
503 and drove the real car form to submission, asserting the translated sentence
appeared and the string `Service unavailable` appeared nowhere on the page. Run
once per locale, both green. First attempt failed and the failure was
instructive: the preview server from the previous phase was still running and
`reuseExistingServer` reused it, so the assertion ran against a stale build.

**6.11 / 6.12 — the live region's structure.** A spec drove a stubbed stream and
dumped the accessibility structure from the page:

```json
{
  "regionClass": "sr-only",
  "regionLive": "polite",
  "regionLabel": "Assistant reply status",
  "caretAriaHidden": "true",
  "busyElementExists": true,
  "liveAncestorsOfStreamingText": [],
  "statusRoleCount": 1
}
```

`liveAncestorsOfStreamingText: []` is the one that matters: the streamed markdown
has no live-region ancestor, so it cannot be re-announced per token. That is the
mechanism 6.11 asserts, established by specification rather than by listening.

**7.9-7.17 — the delete flow.** Three conversations were seeded through the
service-role client against a selected car, then the flow was walked in a
browser: trash icon on a non-active row (URL unchanged, dialog names the clicked
thread), Esc, Cancel, a second row (dialog re-reads its target), confirm, delete
the currently-open thread, delete the last remaining thread, reload, and a DELETE
against a nonexistent uuid. All nine observations matched the checklist.

Two incidental findings from that walk, neither scoped as work here:

- **Esc does not close the delete dialog.** `AlertDialog` is controlled by `open`
  with no `onOpenChange`, so only `AlertDialogCancel` has a path back to state.
  Predicted by the plan; now confirmed.
- **After a delete, the page fully reloads and the `client:idle` dialog island
  needs to rehydrate.** A trash click before that does nothing at all. Benign for
  a human who lets the page settle; it broke the scripted walk until a hydration
  wait was added.

## 2. Not fixed, recorded (from the review's "also noted")

- `useConversation.ts:220` still string-matches the server literal
  `"Conversation not found"` — the exact dependency `http-error-copy.ts` was
  built to remove, one directory away. Pre-existing; out of scope here.
- `ChatError`'s `server` variant carries a `message` field nothing renders.
- `isAuthErrorCode` is one shared set, so `/auth/signin?error=not_configured`
  renders an ops sentence on the sign-in card. Bounded to ten approved strings,
  but not zero — splitting into `SIGNIN_CODES` / `SIGNUP_CODES` would close it.
- The CI failure-path redaction matches only `sb_secret_`/`sb_publishable_`;
  JWT-format (`eyJ…`) and S3 keys would pass through on a failed `supabase start`.
- `e2e/ai-progress.spec.ts` passes `?car=${id}` which nothing reads — selection
  comes from the cookie.
- `gotoHydrated`'s docstring says "every island", but `astro-island[ssr]` does not
  cover `client:only`, and the helper wraps `goto` only, not `reload`.
- `locale-parity.test.ts` strips plural suffixes unconditionally; a real key
  ending in `_one`/`_other` could mask a missing sibling. No collision today.
- `CarForm.tsx:88` and `CarList.tsx:57` parse the error body without `.catch()`,
  unlike the other twelve converted sites.
