# Light/Dark Theme — Renault Palette & Token Migration Implementation Plan

## Overview

Replace the inherited 10x-starter appearance with a deliberate Renault-inspired token
system (yellow / black / white), activate a real light mode behind a server-rendered
theme rail, and migrate 38 files off hardcoded colors onto tokens — with a grep gate
that holds the count at zero afterward.

This change establishes a design system where none existed. There is no prior palette
decision, token convention, or accessibility standard anywhere in 18 archived changes;
`change.md`'s contrast table is the first place ratios have ever been computed in this
project. The token contract, the `--border`/`--input` split, and the contrast table in
this plan therefore _become_ the design system by default.

## Current State Analysis

**The app is a dark design painted on a light token set.** `src/styles/global.css:6-41`
is stock shadcn light — `--background: oklch(1 0 0)` is pure white. `@layer base`
applies it to `body` (`global.css:115-117`), then every page covers it with `bg-cosmic`
(`global.css:107-109`). So every shadcn primitive (`Input`, `Textarea`, `Select`)
resolves _light_ tokens — near-black text, near-white hairlines — onto dark glass
panels. **This is a live contrast defect today**, not merely migration debt.

The `.dark` block at `global.css:43-67` has never executed: nothing anywhere sets the
class. `@custom-variant dark (&:is(.dark *))` at `global.css:4` is wired and idle.

**The migration surface is 38 files, 135 lines, 72 distinct hardcoded color values**
(57 Tailwind utility strings, 12 raw hex, 3 `rgba()`). The grep recorded at
`change.md:23-25` reports 31 because it requires a `[-/]` suffix, so it misses bare
`text-white` (the four `*Entries.tsx` files), `Banner.astro`'s 9 raw hex, `bg-cosmic`'s
3, and `Welcome.astro:25`'s `rgba()` inside an inline `style` attribute.

**Concentration is the good news.** Ten utilities account for ~145 of ~180 occurrences:
`text-white` (45) · `border-white/10` (24) · `text-blue-100/60` (18) · `bg-white/10` (11)
· `bg-white/5` (9) · `text-blue-100/70` (8) · `text-blue-100/50` (8) · `from-blue-200` (8)
· `to-purple-200` (7) · `hover:bg-white/10` (7). Roughly **70% of the literals are a
rename; 30% want a variant.**

**Three pre-existing bugs** sit inside lines this change edits anyway:
`--destructive-foreground` is referenced at `ui/button.tsx:14` and
`EntryDetailEditor.tsx:179` but **never defined**; `FormField.tsx:53`'s `border-white/20`
is a live WCAG 1.4.11 failure (form borders need 3:1); `EntryDetail.astro:116`'s
`text-blue-100/40` is already below 4.5:1.

**Two dead files** were verified to have zero importers: `src/components/ui/sidebar.tsx`
(682 lines, and 40% of the repo's `sidebar-*` token surface, so every future "where do
sidebar colors live" search hits it first) and `src/components/ui/LibBadge.astro`.

**There is no automated coverage of this change's primary failure mode.**
`toHaveScreenshot|toMatchSnapshot|toHaveCSS` returns zero hits repo-wide. The existing
suites stay green through a white-on-white page.

## Desired End State

A user's theme preference is resolved server-side before any HTML is produced, rendered
onto `<html>`, and persisted in a cookie; a user with no stated preference follows
`prefers-color-scheme`. Both modes are complete and readable, every color in `src/`
outside `src/components/ui/` resolves through a token, and `npm run lint:colors` reports
zero — enforced by pre-commit and CI.

Verified by: `npm run lint:colors` exits 0; `npm run lint && npm run typecheck && npm test
&& npm run build` all pass; and a manual two-mode walkthrough of every route confirms no
unstyled or low-contrast element.

### Key Discoveries

- **FOUC is smaller than `change.md` assumed.** `src/middleware.ts:38-41` already
  resolves a cookie before any HTML exists, and `src/layouts/Layout.astro:14` already
  renders a server-computed attribute onto `<html>`. For a user with a stated preference
  the server emits `<html class="dark">` directly — zero FOUC, zero JavaScript,
  `httpOnly` preserved. A script is needed for exactly one case: no stated preference.
- **`httpOnly: true` is the one place theme must diverge from the locale rail.** An
  `HttpOnly` cookie is invisible to `document.cookie`, so no script can read it. This is
  fine, because the script never needs to — it runs only when the class is absent.
- **`@theme inline` is the silent-failure mode of the whole architecture.** A token
  declared in `:root` but not aliased as `--color-*` in `@theme inline`
  (`global.css:69-105`) produces a class that compiles to **nothing** — no error, no
  warning, just an unstyled element. Without `inline`, the alias resolves at `:root`
  once, freezing the light value so `.dark` never reaches it.
- **Class strings must be statically greppable.** `bg-status-warn` written out is found
  by Tailwind's scanner; `` `bg-status-${tone}` `` is **not**, and generates no CSS.
- **Opacity modifiers work on custom tokens** and **`tailwind-merge` 3.5.0 handles them
  with no config** (verified: `twMerge("bg-status-warn bg-status-bad")` → `bg-status-bad`).
  `cn()` stays a 3-line file; no `extendTailwindMerge` wrapper.
- **The cookie → locals → prop rail is the project's settled answer** to persisted
  preference on this stack, used twice (`lang`, `selected_car_id`) with a no-JS
  `<form method="POST">` control (`AppSidebar.astro:63-90`). Recorded rationale
  (`context/archive/2026-06-10-i18n-en-pl/plan.md:50`): "A full reload sidesteps any
  client re-init/hydration timing issue."
- **`@custom-variant dark` needs no extension.** Because the class is always present
  after Phase 7 (server-emitted when stated, script-emitted when not), `&:is(.dark *)`
  is sufficient and shadcn's existing `dark:` utilities never strand.
- **The `*` in the variant matters.** `&:is(.dark *)` matches _descendants_, so the class
  must land on `<html>`, and `<html>` itself will not receive `dark:` utilities.
- **The free win**: `AppSidebar.astro` / `MobileSidebarTrigger.tsx` write
  `bg-[var(--sidebar)]` at 25 sites where `bg-sidebar` already exists. Byte-identical
  CSS, zero visual diff — the cheapest possible proof the token layer works.
- **Staging precedent** (`context/archive/2026-08-24-swallowed-error-propagation/plan.md:150-158`):
  "Each phase leaves the tree green: lint, `astro check`, and `npm test` all pass at every
  phase boundary, because `.husky/pre-commit` runs all three and will refuse the commit."

## What We're NOT Doing

- **Not renaming `DeadlineStatus`.** `"red" | "yellow" | "green"` stays in `src/types.ts`,
  the service, and the DB. The `toneForDeadline` mapper is precisely what makes the rename
  unnecessary; doing it would touch the data layer for a cosmetic gain.
- **Not adding visual-regression tooling.** No `toHaveScreenshot` baselines. This was
  chosen deliberately (see Open Risks) — verification for the sweep is manual.
- **Not touching the three modal scrims** (`ui/alert-dialog.tsx:24`, `ui/dialog.tsx:29`,
  `ui/sheet.tsx:28`). `bg-black/50` is correct in both themes; mapping it to
  `--foreground/50` would invert it in dark mode and break the modals. They are also
  shadcn-owned and get overwritten by `npx shadcn add`.
- **Not touching `ui/button.tsx:14`'s contrast-locked `text-white`** for the same
  ownership reason. `src/components/ui/` is excluded from the lint gate wholesale.
- **Not reopening the sidebar's always-dark decision.** The sidebar stays black in both
  modes with a yellow active indicator — on-brand _and_ less migration.
- **Not adding a third text token.** The existing three-level hierarchy
  (`text-white` > `text-blue-100/70` > `text-blue-100/50`) flattens to
  `--card-foreground` + `--muted-foreground`. The flattening is accepted.
- **Not adding a theme toggle to the four `Layout.astro`-only pages** (`index`,
  `auth/signin`, `auth/signup`, `auth/confirm-email`). They have no sidebar and therefore
  no control surface; they still _render_ in the correct theme.
- **Not building a React theme context.** Astro islands are separate roots and `CLAUDE.md`
  forbids wrapping a page in one island. Nothing needs to read the theme client-side.

## Implementation Approach

Design first, then mechanical conversion, one route family per phase — the in-repo
precedent from `2026-08-24-swallowed-error-propagation`.

The one non-obvious sequencing decision: **the theme rail lands early (Phase 2) but
server-only** — an unset cookie resolves to `DEFAULT_THEME = "dark"`, and no inline
script ships until Phase 7. Three consequences make this the right order:

1. Phase 2 changes nothing visible. Dark-preference users see today's app; the `.dark`
   token block simply starts applying where stock-light tokens used to leak through.
2. Every later phase can be manually verified in **both** modes as it lands. With
   manual-only verification, this is the single most valuable property of the sequencing.
3. The riskiest, most novel element — the first `<script>` in the entire codebase — lands
   alone, in isolation, at the end, once light mode is actually complete and worth
   sending anyone to.

Two architectural layers carry the migration. `src/lib/theme.ts` maps **domain vocabulary
to token vocabulary** (`toneForDeadline`, `toneForResult`) and holds the cva variants for
the recipes with conditional color. `src/lib/theme-preference.ts` holds the preference
rail's const-tuple triple, kept dependency-free so `src/middleware.ts` does not pull cva
into its bundle.

## Critical Implementation Details

**The two-step token shape is mandatory and fails silently.** Every new token needs the
raw value in `:root` _and_ `.dark`, plus a `--color-*` alias in `@theme inline`. Missing
the alias yields a class that compiles to nothing. **Edit `global.css` and `theme.ts` in
the same commit**, with cross-reference comments pointing at each other, mirroring
`src/lib/nav.ts:3`'s existing cross-file-invariant comment.

**Streaming fixes `<html>`'s attributes at flush time.** Astro's `App` defaults to
`streaming = true` and the Cloudflare adapter does not override it. The `<head>` flushes
before the `<body>` finishes, so an inline head script executes very early (good) — but
the `class` attribute written at `Layout.astro:14` is already serialized by then. Only
script can change it afterward, which is exactly what Phase 7's script does and why it
must live in `<head>`, not `<body>`.

**`<script>` must be `is:inline`.** There is no `<script>` tag anywhere in `src/` today —
zero hits for `<script` and zero for `is:inline`. Without `is:inline`, Astro hoists the
script into a deferred external module, which defeats the entire purpose.

**`cookies.set()` is only safe in middleware, an API route, or top-level page
frontmatter.** Astro warns explicitly when called later.

**Ordering in middleware**: theme resolution must sit _outside_ the Supabase `if/else`
and _before_ the `PROTECTED_ROUTES` gate (`middleware.ts:43-47`), for the reason recorded
at `middleware.ts:34-36` — `App.Locals` fields are non-optional, so a branch-local
assignment is a TypeScript error. This is verbatim the same constraint `lang` has.

**E2E determinism**: `e2e/auth.setup.ts:58-60` and `e2e/fixtures/app.ts:165-167` pin
`lang=en` via `context.addCookies` because an inherited `lang=pl` broke name-based
locators. A theme cookie changes rendered classes the same way and needs identical
pinning, or E2E runs become theme-dependent once Phase 7's script starts consulting
Chromium's `prefers-color-scheme`.

**A PostToolUse tripwire exists**: `.claude/settings.json` re-runs both AI specs whenever
`ai.ts`, `chat.ts`, or either spec is edited. Phase 5 touches `ai/ChatDemo.tsx`.

## Phase 1: Token Foundation & the Theme Module

### Overview

Define the complete palette and the domain→token mapping layer, prove the token
indirection works with a zero-visual-diff rename, and remove the dead weight that would
otherwise confuse every future search. No user-visible change except the sidebar's
active-indicator color.

### Changes Required:

#### 1. The palette

**File**: `src/styles/global.css`

**Intent**: Replace the stock shadcn `neutral` grayscale in `:root` and `.dark` with the
Renault-derived palette, and add the tokens the migration needs but that do not exist yet.
This is the design system; every value below is contrast-verified in the table under
"Testing Strategy".

**Contract**: `:root` and `.dark` take the values from `change.md`'s "Proposed tokens"
block, with these additions and one correction:

- `--accent-ink` — the darkened yellow for cases where the brand color must be _ink_.
  Brand yellow at L=0.867 is 1.46:1 on white, so it can never be a link, label, or icon
  in light mode. Light `oklch(0.556 0.110 88.7)`; dark `oklch(0.867 0.164 88.7)`.
- `--status-{ok,warn,bad,info}` — dot fills and borders, ≥3:1.
- `--status-{ok,warn,bad,info}-ink` — text variants, ≥4.5:1. Required because
  `InspectionEntryList.tsx:34` renders pass/fail as _text_, where the dot value fails.
- `--status-idle: var(--muted-foreground)` — the `no_data` / `no_next_date` states.
  Needs no `.dark` entry; it aliases a token that already has one at `global.css:55`.
- `--destructive-foreground` — currently referenced at two sites and never declared.
- **Correction to `change.md`**: dark `--destructive` moves from `oklch(0.680 0.190 25)`
  to `oklch(0.560 0.190 25)`. At 0.680 a near-white label on the fill measures **3.01:1**
  — a failing button. At 0.560 the label reaches 4.91:1 while the fill still holds
  3.73:1 against the dark background. `--destructive` is now purely a _fill_; destructive
  **text** (e.g. `ServerError`) uses `--status-bad-ink`.
- `--sidebar-primary` changes from `oklch(0.78 0.1 280)` (purple) to the brand yellow.
- `color-scheme: light` on `:root` and `color-scheme: dark` on `.dark`, so native form
  controls, scrollbars, and the pre-paint canvas follow the theme. Currently zero hits
  repo-wide.
- Every one of the above gets a matching `--color-*` alias in the existing
  `@theme inline` block. **This is the step that fails silently if skipped.**
- The comment at `global.css:31-32` ("app has no dark-mode toggle") becomes false in
  Phase 2; rewrite it to state that the sidebar is deliberately black in _both_ modes.

Leave `@utility bg-cosmic` in place for now — Phase 3 deletes it together with its five
consumers, so the tree stays green here.

#### 2. The domain→token module

**File**: `src/lib/theme.ts` (new)

**Intent**: One greppable place answering "what color is a warn state?", so the palette
can move without touching 38 files. Decouples DB vocabulary from palette vocabulary —
which is what lets the warn state move off Renault yellow with no data migration.

**Contract**: Exports `type Tone = "ok" | "warn" | "bad" | "idle"`; the mappers
`toneForDeadline(s: DeadlineStatus): Tone` (`red→bad`, `yellow→warn`, `green→ok`, else
`idle`) and `toneForResult(r: string | null): Tone` (`"Passed"→ok`, `"Failed"→bad`, else
`idle`); and the cva variants `statusSurface`, `statusDot`, `statusText`, plus `surface`
(`panel` / `row` levels) and `entryRow`. Follow `src/lib/nav.ts`'s style: a header
comment naming the cross-file invariant — that every token used here must exist as
`--color-*` in `global.css`'s `@theme inline`, and that class strings must be written out
in full because `` `bg-status-${tone}` `` generates no CSS.

The precedent for cva in `.astro` is direct: `DeadlineCard.astro:11-25`'s two
`Record<DeadlineStatus, string>` maps _are_ a cva `variants` block written longhand, and
`ui/button.tsx:7-33` is the idiomatic version.

#### 3. The preference config triple

**File**: `src/lib/theme-preference.ts` (new)

**Intent**: The const-tuple + derived-union + default triple for the preference rail,
mirroring `src/i18n/config.ts:4-6`. Kept separate from `theme.ts` so `src/middleware.ts`
does not pull cva into its bundle.

**Contract**: `THEMES = ["light", "dark"] as const`, `type Theme`, `type ThemePreference
= Theme | "system"`, and `DEFAULT_THEME: ThemePreference = "dark"`. Phase 7 flips
`DEFAULT_THEME` to `"system"`; nothing else changes.

#### 4. The zero-diff proof

**Files**: `src/components/AppSidebar.astro`, `src/components/MobileSidebarTrigger.tsx`

**Intent**: Replace 25 `bg-[var(--sidebar)]` / `text-[var(--sidebar-foreground)]/50`
arbitrary-value sites with the `bg-sidebar` / `text-sidebar-foreground` utilities that
`@theme inline` already registers at `global.css:97-104`. These compile to byte-identical
CSS, so any visual change here means the token layer is misconfigured — which is the
point of doing it first.

**Contract**: No CSS output delta. The only intended visual change in this phase is the
active indicator turning yellow, from the `--sidebar-primary` edit above.

#### 5. Dead code removal

**Files**: `src/components/ui/sidebar.tsx`, `src/components/ui/LibBadge.astro` (both deleted)

**Intent**: Both verified to have zero importers across `src/`, `e2e/`, and `integration/`.
`sidebar.tsx` is 682 lines holding 40% of the repo's `sidebar-*` token surface, and its
`bg-background` at `:295,309` is the only thing in the tree that would break the
black-in-both-modes promise if ever adopted. Read `sidebarMenuButtonVariants` (`:450-470`)
once as a reference for what `AppSidebar.astro` should look like, then delete.

#### 6. Formatter awareness

**File**: `.prettierrc.json`

**Intent**: `prettier-plugin-tailwindcss` is loaded but sets neither `tailwindStylesheet`
nor `tailwindFunctions`, so it does not know about project tokens and **does not sort
class strings inside `cva()` or `cn()` at all** — exactly where this architecture puts
them.

**Contract**: Add `"tailwindStylesheet": "./src/styles/global.css"` and
`"tailwindFunctions": ["cva", "cn"]`. Costs one repo-wide reformat pass; run it as its
own commit so the substantive diff stays readable.

#### 7. The mapper test

**File**: `src/test/theme.test.ts` (new)

**Intent**: Catch the day someone adds a sixth `DeadlineStatus` and it silently falls
through to `idle`.

**Contract**: `vitest.config.ts:34-48` already runs a `unit` project over
`src/test/**/*.test.ts` with the `@` alias wired — no new infrastructure. Assert every
`DeadlineStatus` member maps to its expected `Tone` (exhaustively, driven off the union),
and that `toneForResult` handles `"Passed"`, `"Failed"`, and `null`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass, including the new mapper test: `npm test`
- Production build succeeds: `npm run build`
- No importers were missed: `grep -rn "ui/sidebar\|LibBadge" src/ e2e/ integration/` returns nothing

#### Manual Verification:

- Every route renders **byte-identically to before**, except the sidebar's active indicator, which is now yellow
- The sidebar utility rename produced no visual change whatsoever — if anything moved, a token alias is wrong
- Computed styles confirm the new `--color-status-*` and `--color-accent-ink` utilities resolve to real values in DevTools (an unstyled element here means a missing `@theme inline` alias)

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 2: The Theme Rail (Server-Only)

### Overview

Persist and resolve a theme preference through the project's settled cookie → locals →
`<html>` rail, and add a no-JS toggle. An unset cookie resolves to `dark`, so this phase
is visually inert — but from here on, every subsequent phase can be verified in both
modes as it lands.

### Changes Required:

#### 1. Locals typing

**File**: `src/env.d.ts`

**Intent**: Add the theme to the request-scoped locals alongside `user`, `selectedCarId`, and `lang`.

**Contract**: `theme: import("@/lib/theme-preference").ThemePreference` — non-optional, matching the existing three fields.

#### 2. Resolution

**File**: `src/middleware.ts`

**Intent**: Read and validate the `theme` cookie into `locals`, before any HTML exists.

**Contract**: Mirror the `lang` block at `:38-41` exactly — read the cookie, validate
against `THEMES`, fall back to `DEFAULT_THEME` so the value is never `undefined`. Place
it **outside** the Supabase `if/else` and **before** the `PROTECTED_ROUTES` gate, for the
reason already documented at `:34-36`.

#### 3. The write endpoint

**File**: `src/pages/api/theme/[theme].ts` (new)

**Intent**: Persist the choice and return the user to where they were, exactly as the
locale switch does.

**Contract**: Copy `src/pages/api/lang/[locale].ts` verbatim in shape — a `POST` that
404s on an unrecognized value, sets the cookie with the same four attributes (`path: "/"`,
`httpOnly: true`, `sameSite: "lax"`, `maxAge: 31536000`), and 302s to `Referer ?? "/dashboard"`.
Accept `"system"` as a value that **deletes** the cookie rather than setting it; the
toggle does not offer it until Phase 7, but having the endpoint total now means Phase 7
touches only the UI and the default.

#### 4. Server-rendered class

**File**: `src/layouts/Layout.astro`

**Intent**: Emit the resolved theme onto `<html>` so the correct palette is in the first
byte of HTML — no flash, no JavaScript.

**Contract**: `<html lang={Astro.locals.lang} class={...}>` where the class is the theme
when it is `"light"` or `"dark"`, and absent when `"system"`. Add a comment stating that
this is the **only** place `<html>`'s class is written, since Phase 7's script depends on
that invariant to decide whether to act.

#### 5. The toggle

**Files**: `src/components/AppSidebar.astro`, `src/components/MobileSidebarTrigger.tsx`, `src/layouts/AppLayout.astro`, the i18n message catalogs

**Intent**: A Light/Dark control in the sidebar footer, next to the existing language
toggle.

**Contract**: Two `<form method="POST" action="/api/theme/{light,dark}">` buttons with no
`onClick` and no `preventDefault`, styled from the active/inactive pattern already at
`AppSidebar.astro:63-90`. `MobileSidebarTrigger.tsx` is a byte-for-byte React duplicate
and needs the same markup, plus a `theme` prop threaded from `AppLayout.astro:28-34`
alongside the existing `lang` prop. Add label strings to both locale catalogs. Per
`context/archive/2026-06-10-i18n-en-pl/plan.md:48`, pass the value as a prop — **do not
read it asynchronously after mount.**

#### 6. E2E determinism

**Files**: `e2e/auth.setup.ts`, `e2e/fixtures/app.ts`

**Intent**: Pin the theme so test runs do not become theme-dependent once Phase 7 starts
consulting Chromium's `prefers-color-scheme`.

**Contract**: Add `theme=dark` to the existing `context.addCookies` calls that already
pin `lang=en` (`auth.setup.ts:58-60`, `fixtures/app.ts:165-167`). Same shape, same reason.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- E2E suite still passes with the pinned cookie: `npm run test:e2e`

#### Manual Verification:

- With no cookie set, the app renders exactly as it did before this change (dark)
- Clicking Light sets the cookie, full-reloads, and `<html class="light">` is present in view-source — not added by script
- The preference survives a hard refresh and a new tab
- View-source confirms the class is in the **first** HTML response; there is no flash of the wrong theme on a throttled connection
- Light mode is expected to look broken here — that is the point of Phases 3–6

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: App Shell & Auth

### Overview

Delete `bg-cosmic`, convert the glass panels to opaque cards, and migrate the four auth
surfaces. This is the phase where light mode starts being real, and where two recorded
decisions are deliberately reversed.

### Changes Required:

#### 1. Delete the cosmic background

**Files**: `src/styles/global.css`, `src/layouts/AppLayout.astro:18`, `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/components/Welcome.astro:7`

**Intent**: Remove the `@utility bg-cosmic` gradient (`global.css:107-109`) and collapse
its five consumers to `bg-background`. Renault's identity is flat black/white/yellow with
no gradient; this removes the single most starter-ish element outright.

**Contract**: `Welcome.astro:7` gets `bg-background` here as a holding value; Phase 6
gives the landing hero its final treatment. Note for the record that this **reverses a
decision taken twice** — `2026-06-08-root-routing-landing/plan.md:11,81` explicitly
preserved the cosmic background, and `2026-06-09-sidebar-navigation` then entrenched it
by centralizing it into `AppLayout.astro`. Nothing argued for cosmic on the merits; it
was inherited.

#### 2. The glass panel becomes a card

**Files**: `src/layouts/AppLayout.astro:27,35`, `src/pages/auth/{signin,signup,confirm-email}.astro`

**Intent**: Replace `rounded-2xl border border-white/10 bg-white/10 p-8 text-white
backdrop-blur-xl` with the `surface({ level: "panel" })` variant from `theme.ts`, and drop
`backdrop-blur-xl` entirely. Glass existed only to read against the gradient that no
longer exists — and `bg-white/10` is literally invisible on a white ground.

**Contract**: Panels resolve to `bg-card border-border`. The `from-blue-200 to-purple-200
bg-clip-text text-transparent` gradient headings become plain `text-foreground`. This
reverses `2026-06-09-sidebar-navigation/research.md:91` ("glassmorphism should be
preserved as the content-card visual language"). `AppLayout.astro:27`'s
`border-white/10` → `border-border`; `:35`'s `text-white/80` → `text-muted-foreground`.

#### 3. Auth form controls adopt the primitives

**Files**: `src/components/auth/FormField.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/PasswordToggle.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: `FormField.tsx` hand-rolls an input that `ui/input.tsx` already provides fully
tokenized. Keep its wrapper (label, icon, error slot) but delegate the control.

**Contract**: The bare `<input>` becomes `<Input className="pl-10" aria-invalid={!!error} />`.
This deletes the `inputBase` string, **fixes `:53`'s `border-white/20` 3:1 WCAG 1.4.11
failure for free**, replaces the v3-idiom `focus:ring-*` with the `focus-visible:ring-*`
the rest of the app uses, and gains `aria-invalid` styling the hand-rolled version never
had. It is a real behavioral change — focus rings, height, and padding shift visibly.

`SubmitButton.tsx:18`'s `bg-purple-600 text-white hover:bg-purple-500` is a `className`
that _fights_ the `Button` variant underneath it; delete the override and let
`variant="default"` apply `bg-primary`. `:22`'s spinner needs contrast against the button
_fill_, so `border-primary-foreground/30` + `border-t-primary-foreground`.
`ServerError.tsx:11`'s `border-red-500/30 bg-red-900/30 text-red-300` triple becomes
`border-status-bad/50 bg-status-bad/10 text-status-bad-ink` — note the **ink** token,
because this is text.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- Auth E2E flows still pass: `npm run test:e2e`
- `grep -rn "bg-cosmic" src` returns nothing

#### Manual Verification:

- Sign-in, sign-up, and confirm-email render correctly in **both** modes
- Form validation errors are legible in both modes; the error border meets 3:1
- Input focus rings are visible and consistent with the rest of the app
- The submit button uses brand yellow with a dark label, and its spinner is visible against the fill
- The authenticated shell (sidebar + mobile top bar + content area) is correct in both modes

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Dashboard & the Deadline Traffic Light

### Overview

Convert the domain traffic light to token-driven cva variants. This is the phase the
`--status-*` tokens exist for, and the one where the brand/warning color collision is
actually resolved.

### Changes Required:

#### 1. The traffic light

**File**: `src/components/DeadlineCard.astro`

**Intent**: Replace the two hand-rolled `Record<DeadlineStatus, string>` maps
(`:11-24`, 12 literal color classes) with `statusSurface` / `statusDot` from `theme.ts`,
driven through `toneForDeadline`.

**Contract**: The `red|yellow|green` DB names are translated to `bad|warn|ok` tones at the
component boundary, so `src/types.ts` and `src/lib/services/entries.ts:306-315` are
untouched. **This translation is what lets the warning state move off Renault yellow** —
brand yellow sits ~6° from `amber-400`, and the resolved warn hue is 33.7° away with 0.21
of lightness separation.

`no_data` and `no_next_date` map to `idle` → `border-border bg-muted/40`, which is
**recessed** rather than equal to a real card. Today they share `bg-white/5` with genuine
cards, so "neutral" and "card surface" are indistinguishable; that is the defect being
fixed, not a style preference.

The wrapper's `text-white` is **dropped, not replaced** — the card inherits
`text-foreground` from `@layer base` (`global.css:116`). This is what makes light mode
possible at all. `:31`'s `text-blue-100/70` heading → `text-muted-foreground`.

#### 2. Dashboard surfaces

**Files**: `src/pages/dashboard.astro`, `src/components/LastEntryCard.astro`

**Intent**: The heaviest single file (15 literals) plus its card. Mechanical once the
`surface` variant exists.

**Contract**: Panels → `surface({ level: "panel" })`. The three-level text hierarchy —
`text-white` (value) > `text-blue-100/70` (label) > `text-blue-100/50` (tertiary) —
flattens to `text-foreground` / `text-muted-foreground`; the tertiary level merges into
muted. `LastEntryCard.astro:39` follows the same panel recipe.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- `grep -nE "(red|amber|green|white)-[0-9]" src/components/DeadlineCard.astro` returns nothing

#### Manual Verification:

- All five `DeadlineStatus` states render distinctly in **both** modes — including the two idle states, which must read as recessed rather than as normal cards
- The warn state is visibly distinguishable from brand yellow when a yellow CTA is on screen at the same time
- Status dots are discernible against their surface wash in light mode, where a 10% alpha is weakest
- The dashboard's label/value hierarchy still reads clearly after flattening to two levels

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Entries & Chat

### Overview

The largest file count, but the lowest risk per file — `EntryDetail.astro` alone is 23
literals reducible to two strings. Plus the second hand-rolled control.

### Changes Required:

#### 1. Bulk renames

**Files**: `src/components/entries/EntryDetail.astro`, `src/components/entries/{Repair,OilChange,Insurance}EntryList.tsx:21`, `src/components/entries/{Repair,OilChange,Inspection,Insurance}Entries.tsx:25,29`, `src/components/entries/EntryDetailEditor.tsx:131`, `src/pages/entries.astro`, `src/pages/ai-chat.astro`, `src/pages/entries/[type]/[id].astro`

**Intent**: Straight token substitution — this is the ~70% of the migration that is a rename.

**Contract**: `text-blue-100/60` → `text-muted-foreground`, `text-white` →
`text-card-foreground` (or dropped where `@layer base` already provides it). The four
`*EntryList.tsx:21` rows are byte-identical and collapse to the shared `entryRow` variant.
`EntryDetail.astro:116`'s `text-blue-100/40` — a live sub-4.5:1 failure — becomes
`text-muted-foreground`, which passes at 5.83:1 light / 7.71:1 dark.

#### 2. Conditional color

**Files**: `src/components/entries/EntriesTabs.tsx:57`, `src/components/entries/InspectionEntryList.tsx:34`

**Intent**: The two entries-side cases with state-driven color.

**Contract**: `EntriesTabs.tsx:57`'s active-tab underline `border-b-2 border-purple-400`
→ `border-accent-ink`. `--primary` would be wrong here: it is the brand yellow, which at
1.46:1 on white would read as no rule at all. **This is exactly the case `--accent-ink`
exists for.**

`InspectionEntryList.tsx:34`'s `entry.result === "Passed" ? "text-green-400" :
"text-red-400"` routes through `toneForResult` + `statusText`, yielding
`text-status-ok-ink` / `text-status-bad-ink`. Note this is a **second, different domain
meaning** (pass/fail) sharing tokens with deadline urgency — a deliberate reuse, recorded
here — and because it is _text_ it must use the ink variants, which the dot values would
fail.

#### 3. Chat

**Files**: `src/components/ai/ChatDemo.tsx`, `src/components/ai/StreamingText.tsx`

**Intent**: Same hand-rolled-control problem as `FormField`, against `ui/textarea.tsx`.

**Contract**: `ChatDemo.tsx:73,85,86` adopt `<Textarea>`. `StreamingText.tsx:11`'s
`text-white/90` → `text-foreground` — the `/90` was a deliberate softening with no token
equivalent, and dropping it is the right call rather than inventing one.

**Note**: `.claude/settings.json`'s PostToolUse tripwire re-runs both AI specs when
`ChatDemo`'s neighbors are edited. Expect those specs to fire; they should stay green,
since every locator is role/label-based.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- Full E2E suite passes, including the AI specs: `npm run test:e2e`

#### Manual Verification:

- All four entry types list, detail, create, and edit correctly in **both** modes
- The active tab underline is visible in light mode (this is the `--accent-ink` check — brand yellow here would be invisible)
- Inspection Passed/Failed labels are legible in both modes at text contrast, not just discernible
- The AI chat input, streaming response, and cursor render correctly in both modes

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Landing & Banner

### Overview

The last two files, and the only two the utility-based sweep could never reach: a landing
page built from light-emitting shapes on black, and the app's sole plain-CSS component.

### Changes Required:

#### 1. The landing hero

**File**: `src/components/Welcome.astro`

**Intent**: Delete the three blurred "cosmic orbs" (`:10,14,18`), the `rgba()` star field
in the inline `style` at `:25`, and the tri-stop gradient headlines at `:33,37`. All are
dark-only by construction — there is no token for "decoration" — and they are the most
starter-ish element left.

**Contract**: The hero becomes a flat black section with yellow accents, identical in both
modes. This needs **no new token and no mode axis**: it reuses the already-accepted
"black surface in both modes" precedent from the sidebar, via `bg-sidebar` /
`text-sidebar-foreground`. Yellow on black measures 12.71:1 — the strongest available
expression of the brand. Accept that the landing page loses visual depth; adding
personality back is a separate design pass, not this change.

#### 2. Banner

**File**: `src/components/Banner.astro`

**Intent**: Nine raw hex values in a scoped `<style>` block at `:28-40`. No utility sweep
and no grep rule over class attributes will ever touch this file, so it needs its own
treatment.

**Contract**: Because this is plain CSS, not Tailwind, the variants reference the custom
properties **directly** — `var(--status-info)` for the border, `var(--status-info-ink)`
for the text, and `color-mix(in oklab, var(--status-info) 10%, transparent)` for the
surface. This is the same three-part recipe the utilities express as
`border-status-info` / `text-status-info-ink` / `bg-status-info/10`, written longhand.
The `--status-info` token added in Phase 1 exists specifically for this file — the
proposed palette in `change.md` had no blue.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- No raw hex remains outside `global.css`: `grep -rnE "#[0-9a-fA-F]{3,8}" src --include="*.astro" --include="*.tsx"` returns nothing
- No `rgba(` remains in `src`: `grep -rn "rgba(" src` returns nothing

#### Manual Verification:

- The landing page renders identically in both modes and reads as deliberate, not as a page with its decoration removed
- All three Banner variants (info, warning, error) are legible in both modes and meet 4.5:1 on their own surface
- Banner still renders correctly when `missingConfigs` is non-empty (it sits above `<slot />` in `Layout.astro`, so it must work on every page in both modes)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 7: System Preference & the Gate

### Overview

Turn on `prefers-color-scheme` following — safe to do only now, because light mode is
finally complete — and install the gate that keeps the literal count at zero.

### Changes Required:

#### 1. The inline script

**File**: `src/layouts/Layout.astro`

**Intent**: Resolve the theme for users who have expressed no preference. This is the one
case the server genuinely cannot know.

**Contract**: A `<script is:inline>` in `<head>` that acts **only when `<html>` carries no
class** — the invariant established in Phase 2 that `Layout.astro:14` is the sole writer
of that attribute. It reads `matchMedia("(prefers-color-scheme: dark)")` and sets the
class, then registers a `change` listener so a live OS switch is followed without a
reload. It never reads the cookie, so `httpOnly` survives intact.

`is:inline` is mandatory. Without it Astro hoists the script into a deferred external
module and it runs after paint, which is the entire failure mode this is meant to avoid.
It will be the first `<script>` tag in the codebase.

#### 2. Default flip and the third option

**Files**: `src/lib/theme-preference.ts`, `src/components/AppSidebar.astro`, `src/components/MobileSidebarTrigger.tsx`, the i18n catalogs

**Intent**: Make "system" the default and give users a way back to it.

**Contract**: `DEFAULT_THEME` flips from `"dark"` to `"system"`. The toggle grows a third
form posting to `/api/theme/system`, which deletes the cookie — the endpoint already
handles this from Phase 2. "System" is the active state exactly when the cookie is absent,
which the server knows, so the control stays server-rendered with no client JS.

#### 3. The gate

**Files**: `package.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`

**Intent**: Hold the count at zero. Installed now, at zero, so it never has to be
introduced with a backlog.

**Contract**: A `lint:colors` script grepping palette literals across `*.astro` and
`*.tsx` with `--exclude-dir=ui`, exiting non-zero on any hit. The pattern must match a
bare `text-white` as well as suffixed forms — the grep at `change.md:23-25` requires a
`[-/]` suffix and therefore under-reports by 7 files, which is how the surface was
believed to be 31 rather than 38. `src/components/ui/` is excluded wholesale: it holds
four _legitimate_ literals (`button.tsx:14`'s contrast-locked `text-white` and the three
`bg-black/50` scrims) which are shadcn-owned and get overwritten by `npx shadcn add`;
policing them is permanent merge friction for no benefit. `LibBadge.astro`, the one
project-authored file that lived there, was deleted in Phase 1, so no allowlist is needed.

Wire into `.husky/pre-commit` (already `set -e` plus lint → typecheck → test) and CI.
Runs in ~50 ms with zero new dependencies. ESLint `no-restricted-syntax` is the
longer-term ergonomic upgrade but is deliberately not adopted here: its `Literal` selector
fires on any string, not just class attributes.

#### 4. Documentation

**File**: `src/styles/global.css` (header comment)

**Intent**: This change _is_ the design system; write down the contract so the next person
does not have to re-derive it.

**Contract**: A header comment stating the two-step token rule (raw value in `:root` and
`.dark`, `--color-*` alias in `@theme inline`), that omitting the alias fails silently,
that `inline` is load-bearing because without it the alias resolves at `:root` once and
freezes the light value, and that yellow is a surface and never text — pointing at
`--accent-ink` for the cases where the brand color must be ink.

### Success Criteria:

#### Automated Verification:

- `npm run lint:colors` exits 0
- The gate actually fires: temporarily adding `text-white` to any `src/pages/*.astro` makes `npm run lint:colors` exit non-zero (revert after)
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- Full E2E suite passes: `npm run test:e2e`
- Pre-commit rejects a commit containing a hardcoded color

#### Manual Verification:

- With no cookie and OS set to light, the app loads light with **no flash of dark** — throttle the connection and confirm
- With no cookie and OS set to dark, the app loads dark with no flash
- Switching the OS theme while the page is open flips the app live, with no reload
- Choosing an explicit Light or Dark overrides the OS preference and survives a refresh
- Choosing System clears the override and the app follows the OS again
- View-source on an explicit preference shows the class server-rendered — script is not involved
- Native form controls, scrollbars, and the pre-paint canvas follow the theme (`color-scheme`)

**Implementation Note**: This is the final phase. After manual confirmation, the change is complete.

---

## Testing Strategy

### The contrast contract

Every value below was computed (oklch → sRGB → relative luminance → WCAG), not estimated.
Grounds are `--card` in each mode. **Re-verify with the same method if any lightness moves.**

| Token                                         | Role                 | Threshold | Light |     Dark |
| --------------------------------------------- | -------------------- | --------: | ----: | -------: |
| `--foreground` on `--background`              | body text            |       4.5 | 18.86 |    17.53 |
| `--muted-foreground`                          | secondary text       |       4.5 |  5.83 |     7.71 |
| `--primary-foreground` on `--primary`         | CTA label            |       4.5 | 12.90 |    12.71 |
| `--destructive-foreground` on `--destructive` | button label         |       4.5 |  5.18 | **4.91** |
| `--input`                                     | form border          |       3.0 |  3.22 |     3.00 |
| `--accent-ink`                                | brand as text/border |       4.5 |  4.76 |    11.64 |
| `--status-ok`                                 | dot / border         |       3.0 |  3.70 |     7.55 |
| `--status-warn`                               | dot / border         |       3.0 |  3.30 |     7.82 |
| `--status-bad`                                | dot / border         |       3.0 |  4.38 |     6.02 |
| `--status-info`                               | dot / border         |       3.0 |  4.89 |     7.10 |
| `--status-ok-ink`                             | text                 |       4.5 |  6.16 |     9.94 |
| `--status-warn-ink`                           | text                 |       4.5 |  5.76 |     9.81 |
| `--status-bad-ink`                            | text                 |       4.5 |  6.12 |     7.69 |
| `--status-info-ink`                           | text                 |       4.5 |  6.07 |     9.43 |

All values are inside the sRGB gamut. Brand yellow `oklch(0.867 0.165 88.7)` sits exactly
on the boundary (R = 1.002, a 0.2% clip rendering as `#ffcc32`); `C = 0.164` is provably
inside and renders `#ffcc35`. Either is acceptable — prefer `0.164`.

`--status-warn` light at 3.30 and `--input` dark at 3.00 are the two thinnest margins.
Neither has room to darken or lighten without re-verification.

### Unit Tests

- `toneForDeadline` maps every `DeadlineStatus` member exhaustively, driven off the union so a sixth member breaks the build
- `toneForResult` handles `"Passed"`, `"Failed"`, and `null`
- No test asserts on class strings — that would just restate the implementation

### Integration Tests

No new integration coverage. This change touches no data access, no RLS, and no service
logic. The existing 5 integration files must stay green.

### Manual Testing Steps

Verification for this change is **manual by decision** (see Open Risks). Each phase's
walkthrough is:

1. Set the theme cookie to `light`, reload, and walk every route the phase touched
2. Set it to `dark`, reload, and walk the same routes
3. On each, look specifically for the two failure signatures: an element with **no
   styling at all** (a missing `@theme inline` alias, or a dynamically-built class string),
   and text that is technically visible but **low-contrast** (an ink token where a fill
   token was used, or vice versa)
4. Spot-check computed styles in DevTools for anything driven by a new token

Full route inventory for the final pass: `/`, `/auth/signin`, `/auth/signup`,
`/auth/confirm-email`, `/dashboard`, `/entries`, `/entries/{type}/{id}` for all four
types, `/ai-chat` — each in both modes, plus mobile viewport for the sidebar sheet.

## Performance Considerations

Net positive, marginally. Deleting `backdrop-blur-xl` from 7+ panels removes a real
per-panel compositing cost. The inline script is ~10 lines and runs once. `@theme inline`
substitutes values into utilities rather than adding a `var()` indirection layer, so there
is no runtime resolution cost. Deleting 682 dead lines from `ui/sidebar.tsx` does not
change the bundle — it was never imported — but it does shrink the type-check surface.

## Migration Notes

No data migration. `DeadlineStatus` keeps its `"red" | "yellow" | "green"` values in the
database and in `src/types.ts`; the `toneForDeadline` mapper is the entire adaptation
layer, which is precisely why the rename can be deferred indefinitely.

The theme cookie is additive — absent means `DEFAULT_THEME`, so existing sessions are
unaffected and no backfill is needed. Rollback at any phase boundary is a plain revert;
each phase leaves the tree green because `.husky/pre-commit` runs lint, typecheck, and
tests and refuses the commit otherwise.

## References

- Change brief: `context/changes/light-dark-mode/change.md` — the palette, the traffic-light collision analysis, and the original contrast table
- Research: `context/changes/light-dark-mode/research.md` — toggle mechanics, the 38-file inventory, the theme-manager proposal
- Phasing precedent: `context/archive/2026-08-24-swallowed-error-propagation/plan.md:150-158`
- The cookie → locals → prop rail: `context/archive/2026-06-10-i18n-en-pl/plan.md:10,48,50`
- Glassmorphism decision being reversed: `context/archive/2026-06-09-sidebar-navigation/research.md:91`
- Cosmic background preservation being reversed: `context/archive/2026-06-08-root-routing-landing/plan.md:11,81`
- Visual-test exclusion with its re-evaluate clause: `context/foundation/test-plan.md` §7
- cva precedent: `src/components/ui/button.tsx:7-33`
- Config-as-data precedent: `src/lib/nav.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Token Foundation & the Theme Module

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — e9a0eb7
- [x] 1.2 Type checking passes: `npm run typecheck` — e9a0eb7
- [x] 1.3 Unit tests pass, including the new mapper test: `npm test` — e9a0eb7
- [x] 1.4 Production build succeeds: `npm run build` — e9a0eb7
- [x] 1.5 No importers were missed for the deleted files — e9a0eb7

#### Manual

- [x] 1.6 Every route renders byte-identically except the sidebar's now-yellow active indicator — e9a0eb7
- [x] 1.7 The sidebar utility rename produced no visual change whatsoever — e9a0eb7
- [x] 1.8 New `--color-status-*` / `--color-accent-ink` utilities resolve to real values in DevTools — e9a0eb7

### Phase 2: The Theme Rail (Server-Only)

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 5b3a2ef
- [x] 2.2 Type checking passes: `npm run typecheck` — 5b3a2ef
- [x] 2.3 Unit tests pass: `npm test` — 5b3a2ef
- [x] 2.4 Production build succeeds: `npm run build` — 5b3a2ef
- [x] 2.5 E2E suite passes with the pinned theme cookie: `npm run test:e2e` — 5b3a2ef

#### Manual

- [x] 2.6 With no cookie, the app renders exactly as before (dark) — 5b3a2ef
- [x] 2.7 Clicking Light sets the cookie and `<html class="light">` is in view-source — 5b3a2ef
- [x] 2.8 The preference survives a hard refresh and a new tab — 5b3a2ef
- [x] 2.9 The class is in the first HTML response; no flash on a throttled connection — 5b3a2ef

### Phase 3: App Shell & Auth

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 5475cba
- [x] 3.2 Type checking passes: `npm run typecheck` — 5475cba
- [x] 3.3 Unit tests pass: `npm test` — 5475cba
- [x] 3.4 Production build succeeds: `npm run build` — 5475cba
- [x] 3.5 Auth E2E flows pass: `npm run test:e2e` — 5475cba
- [x] 3.6 `grep -rn "bg-cosmic" src` returns nothing — 5475cba

#### Manual

- [x] 3.7 Sign-in, sign-up, confirm-email render correctly in both modes — 5475cba
- [x] 3.8 Validation errors are legible in both modes; error border meets 3:1 — 5475cba
- [x] 3.9 Input focus rings are visible and consistent — 5475cba
- [x] 3.10 Submit button is brand yellow with a dark label; spinner visible against the fill — 5475cba
- [x] 3.11 The authenticated shell is correct in both modes — 5475cba

### Phase 4: Dashboard & the Deadline Traffic Light

#### Automated

- [x] 4.1 Linting passes: `npm run lint` — 76d49c6
- [x] 4.2 Type checking passes: `npm run typecheck` — 76d49c6
- [x] 4.3 Unit tests pass: `npm test` — 76d49c6
- [x] 4.4 Production build succeeds: `npm run build` — 76d49c6
- [x] 4.5 No color literals remain in `DeadlineCard.astro` — 76d49c6

#### Manual

- [x] 4.6 All five DeadlineStatus states render distinctly in both modes; idle states read as recessed — 76d49c6
- [x] 4.7 The warn state is distinguishable from brand yellow with a yellow CTA on screen — 76d49c6
- [x] 4.8 Status dots are discernible against their wash in light mode — 76d49c6
- [x] 4.9 The dashboard label/value hierarchy still reads clearly after flattening — 76d49c6

### Phase 5: Entries & Chat

#### Automated

- [x] 5.1 Linting passes: `npm run lint`
- [x] 5.2 Type checking passes: `npm run typecheck`
- [x] 5.3 Unit tests pass: `npm test`
- [x] 5.4 Production build succeeds: `npm run build`
- [x] 5.5 Full E2E suite passes, including the AI specs: `npm run test:e2e`

#### Manual

- [x] 5.6 All four entry types list, detail, create, and edit correctly in both modes
- [x] 5.7 The active tab underline is visible in light mode
- [x] 5.8 Inspection Passed/Failed labels are legible at text contrast in both modes
- [x] 5.9 AI chat input, streaming response, and cursor render correctly in both modes

### Phase 6: Landing & Banner

#### Automated

- [ ] 6.1 Linting passes: `npm run lint`
- [ ] 6.2 Type checking passes: `npm run typecheck`
- [ ] 6.3 Unit tests pass: `npm test`
- [ ] 6.4 Production build succeeds: `npm run build`
- [ ] 6.5 No raw hex remains outside `global.css`
- [ ] 6.6 No `rgba(` remains in `src`

#### Manual

- [ ] 6.7 The landing page renders identically in both modes and reads as deliberate
- [ ] 6.8 All three Banner variants are legible in both modes at 4.5:1
- [ ] 6.9 Banner renders correctly on every page when `missingConfigs` is non-empty

### Phase 7: System Preference & the Gate

#### Automated

- [ ] 7.1 `npm run lint:colors` exits 0
- [ ] 7.2 The gate fires on a deliberately added literal (revert after)
- [ ] 7.3 Linting passes: `npm run lint`
- [ ] 7.4 Type checking passes: `npm run typecheck`
- [ ] 7.5 Unit tests pass: `npm test`
- [ ] 7.6 Production build succeeds: `npm run build`
- [ ] 7.7 Full E2E suite passes: `npm run test:e2e`
- [ ] 7.8 Pre-commit rejects a commit containing a hardcoded color

#### Manual

- [ ] 7.9 No cookie + OS light loads light with no flash (throttled)
- [ ] 7.10 No cookie + OS dark loads dark with no flash
- [ ] 7.11 Switching the OS theme flips the app live, no reload
- [ ] 7.12 An explicit Light/Dark overrides the OS preference and survives a refresh
- [ ] 7.13 Choosing System clears the override and follows the OS again
- [ ] 7.14 View-source shows the class server-rendered for an explicit preference
- [ ] 7.15 Native controls, scrollbars, and the pre-paint canvas follow the theme
