# Root Routing + Minimal Landing Page Implementation Plan

## Overview

Replace the 10x Astro Starter boilerplate at `/` with a minimal CarBooklet-branded landing page. Authenticated users visiting `/` are immediately redirected to `/dashboard`; unauthenticated users see the new landing page with Sign In and Sign Up CTAs.

## Current State Analysis

- `src/pages/index.astro` renders `Welcome.astro` — "10x Astro Starter" headline, generic feature cards, no auth-state awareness.
- `src/middleware.ts` resolves `Astro.locals.user` on **every** request (not only protected routes), so auth state is already available at `/` with zero extra work.
- `Welcome.astro` already uses the cosmic design language (gradient background, glassmorphism, Topbar) and has functional Sign In / Sign Up buttons at the correct hrefs — only the copy and structure need changing.
- `/` is not in `PROTECTED_ROUTES`; the redirect for authenticated users must be handled in the page, not middleware.

## Desired End State

`/` never shows boilerplate. Authenticated users land on `/dashboard`; everyone else sees a CarBooklet landing page — headline "CarBooklet", tagline explaining the app's purpose, and Sign In / Sign Up CTAs — in the existing cosmic visual style.

### Key Discoveries

- `Astro.locals.user` is non-null when a valid session cookie is present (set by middleware at `src/middleware.ts:14`). Reading it in `index.astro` frontmatter and calling `return Astro.redirect("/dashboard")` is the idiomatic Astro SSR pattern — no middleware change required.
- `Welcome.astro` holds all the landing markup. The file has one user (`index.astro`) so rewriting its content is a contained change.
- The three feature card `<div>` blocks below the hero section (`Welcome.astro:57–124`) reference the starter — remove them entirely; hero + CTAs only per the agreed scope.

## What We're NOT Doing

- No changes to `src/middleware.ts` or `PROTECTED_ROUTES`.
- No new layout or page components.
- No feature cards on the landing page.
- No changes to any auth, API, or data layer.

## Implementation Approach

Two surgical edits, phased so each is independently verifiable:

1. **index.astro** — add the auth-state redirect (one line in the frontmatter).
2. **Welcome.astro** — rewrite the landing copy and remove the feature cards; keep the cosmic shell intact.

## Phase 1: Auth-State Redirect

### Overview

Ensure that an authenticated user arriving at `/` is immediately sent to `/dashboard` without ever rendering the landing page.

### Changes Required

#### 1. `src/pages/index.astro`

**File**: `src/pages/index.astro`

**Intent**: Read the already-resolved `Astro.locals.user` in the frontmatter and redirect to `/dashboard` when it is truthy. The page renders only for unauthenticated visitors.

**Contract**: In the Astro frontmatter (before any imports are consumed), add:

```ts
const { user } = Astro.locals;
if (user) return Astro.redirect("/dashboard");
```

No other change to this file.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Visit `/` while logged in → browser redirects to `/dashboard`.
- Visit `/` while logged out → landing page renders (Welcome component visible).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Landing Page Content

### Overview

Replace the 10x Astro Starter boilerplate copy and feature cards in `Welcome.astro` with CarBooklet-branded content. Keep the cosmic background, Topbar, and CTA button structure intact.

### Changes Required

#### 1. `src/components/Welcome.astro`

**File**: `src/components/Welcome.astro`

**Intent**: Swap the starter headline and tagline for CarBooklet copy, and remove the three feature card blocks below the hero — the landing page is hero + CTAs only per agreed scope.

**Contract**:
- `<h1>` text: replace "10x Astro Starter" with "CarBooklet".
- `<p>` tagline text: replace the existing sentence with "Track your car's full service history — repairs, oil changes, inspections, and insurance — in one place."
- Remove the entire feature-cards grid `<div>` (`mx-auto grid max-w-4xl …`) and its three child `<div>` blocks.
- All other markup (cosmic orbs, star field, Topbar import/usage, CTA button hrefs, Tailwind classes) remains unchanged.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Landing page headline reads "CarBooklet".
- Tagline matches: "Track your car's full service history — repairs, oil changes, inspections, and insurance — in one place."
- No feature cards visible below the hero.
- Sign In and Sign Up buttons are present and link to `/auth/signin` and `/auth/signup` respectively.
- Cosmic background and Topbar render correctly.
- No visual regressions on protected pages (dashboard, entries, cars, ai-chat) — Topbar unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps

1. Log out completely. Visit `/`. Confirm landing page renders with "CarBooklet" headline and two CTAs. No feature cards.
2. Click "Sign In" → confirm routes to `/auth/signin`.
3. Click "Sign Up" → confirm routes to `/auth/signup`.
4. Sign in with a valid account. Visit `/` directly → confirm redirect to `/dashboard`.
5. Smoke-test protected pages (dashboard, entries, cars, ai-chat) to confirm Topbar and layouts are unchanged.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-01
- PRD refs: US-01, FR-001 in `context/foundation/prd-v2.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Auth-State Redirect

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`

#### Manual

- [x] 1.3 Visit `/` while logged in → redirects to `/dashboard`
- [x] 1.4 Visit `/` while logged out → landing page renders

### Phase 2: Landing Page Content

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 Headline reads "CarBooklet"
- [ ] 2.4 Tagline matches approved copy
- [ ] 2.5 No feature cards visible
- [ ] 2.6 Sign In and Sign Up buttons present and route correctly
- [ ] 2.7 Cosmic background and Topbar render correctly
- [ ] 2.8 No visual regressions on protected pages
