# Follow-ups from the implementation review

Queued during triage of `reviews/impl-review.md` (2026-08-27). These were deliberately
not fixed inside `swallowed-error-propagation`.

## F8 — Auth routes reflect an unvalidated error string into the page

**Files**: `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16`

Both do `context.redirect("/auth/signin?error=" + encodeURIComponent(error.message))`.
`signin.astro:8` reads that parameter and passes it to `SignInForm` → `ServerError.tsx:12`,
which renders it.

**Not an XSS.** React escapes the value, and this was verified rather than assumed.

**What it is.** The parameter is not validated against any allowlist, so a crafted link
renders attacker-chosen text inside the app's own sign-in card, on the real origin —
`/auth/signin?error=Your+account+is+locked,+call+555-0100` is a credible phishing surface.
Secondarily, `error.message` distinguishes "Invalid login credentials" from "Email not
confirmed", which is a user-enumeration signal, and neither route logs anything, so
credential stuffing leaves no server-side trace at all.

**Why it was out of scope.** `plan.md`'s "What We're NOT Doing" excludes both files by
decision: same defect class, different subsystem (GoTrue rather than PostgREST, and the
message is not Postgres-authored). That boundary was respected throughout.

**Shape of the fix.** Map GoTrue errors to a small closed set of codes
(`?error=invalid_credentials`), translate them client-side through the existing i18n
machinery, and route the real error through `logApiError` with
`route: "/api/auth/signin"`. The mapper and logger this change built are already the
right home for it — `api-errors.ts` would need a second table keyed on GoTrue's error
names rather than PostgREST codes.

**Note.** Fixing this would also close the one asymmetry F10 records: auth errors _can_
be translated, because they are chosen from a closed set rather than authored by the
database.

## F9 — `chat.ts` logs a raw SDK error that can carry the API key

**Files**: `src/pages/api/ai/chat.ts:55,72`

Two `console.error("[ai/chat] …:", err)` calls survive this change.

**Why they survived.** `plan.md`'s "What We're NOT Doing" says: "Not refactoring
`src/pages/api/ai/chat.ts`'s existing catch blocks (`:43-50`, `:54-73`). They already log
and propagate correctly." Phase 6 added a guard around the unprotected `getCarById` call
and nothing else, exactly as instructed.

**Two problems the exclusion leaves standing.**

1. **Unqueryable.** These are the last two string-plus-second-argument logs in the app.
   `api-errors.ts` documents why that form is wrong on this runtime: Cloudflare indexes
   the top-level keys of a _single_ logged object and does not merge a second positional
   argument, so each of these collapses into one opaque string.

2. **A credential can reach the log store.** The caught value is the OpenRouter SDK error,
   and the repo's own test output demonstrates the shape:
   `[ai/chat] Service error: Error: 401 Invalid API key: sk-or-test-LEAK`. The response
   body is clean — the route returns a generic `"AI service error"` — but Workers Logs is
   not. This is the more serious half and is arguably worth more than the OBSERVATION
   rating it was given during triage.

**A note against this change.** Phase 2 relaxed `no-console` to `["warn", { allow: ["error"] }]`
so the new structured logging would not need twenty `eslint-disable` comments. A side
effect is that these two calls no longer carry a disable comment either, removing the one
piece of friction that would have drawn a reader's eye to them.

**Shape of the fix.** Route both through `logApiError` with
`route: "/api/ai/chat"`, and redact before logging — either log
`err instanceof Error ? err.name : typeof err` plus a status, or strip anything matching
the key format from the message. Whichever is chosen, the existing eight `toEqual` envelope
assertions in `src/test/pages/api/ai/chat.test.ts` must stay green; editing this file also
fires the repo's R1 tripwire hook, which runs them automatically.

## F10 — API errors stay English while the new SSR banner is translated

**File**: `src/lib/api-errors.ts:30-34`

The five client-facing literals — "Invalid request", "Unauthorized", "Not found",
"Server error", "Service unavailable" — are hardcoded English. Every consumer renders
them verbatim: `CarForm.tsx:89`, all eight `*EntryForm.tsx`, `CarList.tsx:55,93`,
`EntryDetailEditor.tsx:64`, each doing `setApiError(json.error ?? t("common.anErrorOccurred"))`.
Because `error` is always present, the translated fallback never fires.

**Why it is like this.** Two of the plan's non-goals close the obvious routes:
"Not fixing i18n for API errors" (the fallback is already dead today, so sending a generic
English literal changes nothing), and "Not adding a `code` field to the response envelope"
(it would break the eight `toEqual` assertions in `chat.test.ts` and hand the client detail
it has no use for). Both were deliberate.

**What is new.** Phase 6 added `common.loadFailed` to `en.json` _and_ `pl.json` for the SSR
banner, because that one is server-rendered through `getT` and cost nothing to translate.
So a Polish user now sees a Polish banner on `/cars` and "Service unavailable" inside an
entry form on the same session. That asymmetry did not exist before this change, and it is
the most likely thing to be reported as a regression even though every individual piece is
an improvement on rendering English Postgres text.

**Shape of the fix, avoiding both non-goals.** The clients already have the HTTP status,
which is a closed set and carries exactly the same information as a `code` field would.
Have each consumer map `res.status` to an i18n key locally and stop reading `json.error` for
these five cases. That needs no envelope change, so the eight `toEqual` assertions are
untouched, and it retires the dead `?? t("common.anErrorOccurred")` fallback at fourteen
DOM sites.

**Sequencing.** Worth doing together with F8 — that fix introduces translated auth errors,
and doing both at once gives the app one consistent story about who translates what.
