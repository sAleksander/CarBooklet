<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sidebar Navigation

- **Plan**: context/changes/sidebar-navigation/plan.md
- **Scope**: All Phases (1–4 of 4)
- **Date**: 2026-06-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

## Findings

### F1 — Lint failures marked complete in Progress

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/ai-chat.astro:21 · src/pages/entries.astro:39
- **Detail**: Progress 4.3 ("npm run lint passes") was marked [x] but lint produced 2 `prefer-optional-chain` errors on `if (!car || car.user_id !== user.id)`. dashboard.astro already used the optional-chain form.
- **Fix**: Changed both lines to `if (car?.user_id !== user.id)` to match dashboard.astro.
- **Decision**: FIXED

### F2 — MobileSidebarTrigger uses bare Button + useState instead of SheetTrigger

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/MobileSidebarTrigger.tsx:21–31
- **Detail**: Plan specified `<SheetTrigger>` wrapping the Menu button (shadcn canonical pattern). Implementation used `useState` + bare `Button onClick` instead. Without SheetTrigger, Radix did not inject `aria-expanded` / `aria-controls` on the hamburger button — accessibility gap on mobile.
- **Fix A ⭐**: Wrapped Button with `<SheetTrigger asChild>`, removed `useState`, replaced `onClick={() => setOpen(false)}` on nav links with `<SheetClose asChild>`.
  - Strength: Restores Radix ARIA wiring; matches plan and shadcn pattern; removes bespoke state management.
  - Tradeoff: Nav-link close behaviour needs SheetClose — small rework applied.
  - Confidence: MED
  - Blind spot: None after implementation.
- **Decision**: FIXED via Fix A

### F3 — cars.astro missing auth guard (defense-in-depth removed)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/cars.astro:10–12
- **Detail**: Safety agent reported the guard was missing. On reading the file, `if (!supabase || !user) return Astro.redirect("/auth/signin")` was already present at lines 10–12 and `user` IS used in that guard. False positive.
- **Decision**: FALSE POSITIVE — no action needed

### F4 — NAV_ITEMS and PROTECTED_ROUTES are separate, unsynchronised lists

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/nav.ts · src/middleware.ts
- **Detail**: NAV_ITEMS and middleware's PROTECTED_ROUTES overlap but are entirely independent. `/cars` is intentionally excluded from NAV_ITEMS (car-switcher only) but nothing documented that decision.
- **Fix**: Added a cross-reference comment in nav.ts noting the intentional `/cars` exclusion and pointing to PROTECTED_ROUTES in middleware.ts.
- **Decision**: FIXED

### F5 — user destructured but unused in cars.astro

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/cars.astro:7
- **Detail**: Safety agent reported `user` was destructured but unused. On reading the file, `user` IS used in the auth guard at line 10. False positive.
- **Decision**: FALSE POSITIVE — no action needed

### F6 — Active route startsWith without trailing slash

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/AppSidebar.astro:37 · src/components/MobileSidebarTrigger.tsx:60
- **Detail**: `pathname.startsWith(item.href)` would incorrectly highlight Entries for a future `/entries-archive` route.
- **Fix**: Replaced with `pathname === item.href || pathname.startsWith(item.href + "/")` in both components.
- **Decision**: FIXED

### F7 — --sidebar-* CSS vars absent from .dark block

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/styles/global.css:31–38
- **Detail**: All other token groups have both `:root` and `.dark` overrides. Sidebar vars are intentionally dark-only (no dark-mode toggle in the app) but nothing documented that decision.
- **Fix**: Added a comment above the `--sidebar-*` block explaining they are intentionally dark-only and not theme-aware.
- **Decision**: FIXED

### F8 — entries.astro fires 5 parallel DB calls before null-checking car

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/entries.astro:26–39
- **Detail**: `Promise.all` included `getCarById` alongside 4 entry queries, so all 4 entry fetches ran even when `getCarById` returned null. Micro-inefficiency, not a bug.
- **Fix**: Split into two stages — pre-flight `getCarById` + guard, then parallel `Promise.all` for the 4 entry queries.
- **Decision**: FIXED
