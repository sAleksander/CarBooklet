# Sidebar Navigation — Plan Brief

> Full plan: `context/changes/sidebar-navigation/plan.md`
> Research: `context/changes/sidebar-navigation/research.md`

## What & Why

Replace the horizontal `Topbar.astro` per-page nav with a persistent sidebar on all four protected pages. Required by PRD v2 FR-002/FR-003/FR-004 (all must-have) and listed as roadmap slice S-02 (status: ready). The sidebar must show an active-state indicator and collapse to a mobile-friendly pattern.

## Starting Point

One bare `Layout.astro` document shell (no nav), `Topbar.astro` manually imported by three of four protected pages, and `/cars` entirely navigation-less. No active-route highlighting exists anywhere in the codebase.

## Desired End State

Every protected route (`/dashboard`, `/entries`, `/ai-chat`, `/cars`) renders inside a new `AppLayout.astro` that houses a persistent dark sidebar with three nav items, a car-switcher widget at the top, and user email + sign-out at the bottom. The active nav item is highlighted. On mobile, a hamburger button opens the nav as a Sheet overlay. `Topbar.astro` is deleted; `Welcome.astro` is cleaned up.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| App shell approach | New `AppLayout.astro` wrapping `Layout.astro` | Keeps public pages (auth, landing) on the bare shell; single place for sidebar chrome | Research |
| `/cars` in nav | Car-switcher widget (not a nav item) | Shows which car is active on every page; more contextual than a generic "My Cars" link | Plan |
| Mobile pattern | Hamburger → Sheet overlay | shadcn `Sheet` handles overlay/backdrop/animation out of the box; no custom CSS needed | Plan |
| Desktop sidebar mode | Fixed full-width (no collapse) | PRD doesn't require desktop collapse; avoids icon-only/tooltip complexity | Plan |
| Sidebar visual style | Dark/cosmic match (override CSS vars) | App is always dark; default shadcn sidebar is near-white and would look disconnected | Plan |
| Topbar fate | Delete entirely; update Welcome.astro | Hero already has Sign In/Sign Up CTAs inline; Topbar becomes dead code after migration | Plan |
| Sidebar React vs Astro | Desktop: Astro (SSR). Mobile: React island | Desktop sidebar is static; only mobile toggle needs client-side state | Research / Plan |
| Shared nav config | `src/lib/nav.ts` exports `NAV_ITEMS` | Prevents nav list drifting between desktop Astro and mobile React components | Plan |

## Scope

**In scope:**
- `src/layouts/AppLayout.astro` (new authenticated shell)
- `src/components/AppSidebar.astro` (server-rendered desktop sidebar)
- `src/components/MobileSidebarTrigger.tsx` (React Sheet island for mobile)
- `src/lib/nav.ts` (shared nav item config)
- shadcn installs: `sidebar`, `sheet`, `scroll-area`, `separator`
- CSS var overrides in `src/styles/global.css` (dark sidebar palette)
- Migration of `dashboard.astro`, `entries.astro`, `ai-chat.astro`, `cars.astro` to AppLayout
- Delete `Topbar.astro`; remove Topbar from `Welcome.astro`

**Out of scope:**
- Desktop sidebar collapse / icon-only mode
- Bottom navigation bar on mobile
- Any changes to middleware, API routes, or database
- Auth pages and landing page layout
- Smoke-testing car CRUD correctness or AI streaming (verification only, not new work)

## Architecture / Approach

`AppLayout.astro` wraps the existing `Layout.astro` (document shell) and adds a `flex h-screen overflow-hidden` container. Desktop: `AppSidebar.astro` occupies the left column (`hidden md:flex`); a `<main class="flex-1 overflow-auto p-4">` holds the slot. Mobile: a `<header class="flex md:hidden ...">` contains `MobileSidebarTrigger` (React `client:load`). Auth state flows from `Astro.locals` set by middleware — no prop drilling needed. The `selectedCar` prop (optional `Car`) is passed from pages that already have it; the car-switcher degrades to "Select a car" when absent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Install + CSS vars | shadcn packages in place; sidebar vars dark | shadcn CLI may modify global.css — review diff |
| 2. AppSidebar + MobileSidebarTrigger | Both sidebar components built and spot-tested | Nav item duplication prevented only if `nav.ts` is used by both |
| 3. AppLayout shell | Authenticated app shell working on one page | `h-screen overflow-hidden` model must be correct or scroll breaks |
| 4. Migrate pages + Topbar cleanup | All 4 routes on AppLayout; Topbar deleted | Regression across entire protected app — full smoke test required |

**Prerequisites:** Local dev server running; Supabase stack running (`npx supabase start`); at least one car in the test account
**Estimated effort:** ~1 focused session across 4 phases

## Open Risks & Assumptions

- shadcn sidebar install in Tailwind v4 context — verify that `bg-sidebar` utility classes are generated correctly after install; fallback is using `bg-[var(--sidebar)]` arbitrary values
- `Car` type import in `MobileSidebarTrigger.tsx` — confirm `@/types` path resolves in a React file in this project (it should per tsconfig paths)
- S-03 and S-04 (downstream roadmap slices) will add new routes — they must be added to `NAV_ITEMS` in `src/lib/nav.ts` and `PROTECTED_ROUTES` in middleware at that time

## Success Criteria (Summary)

- All four protected routes render with the sidebar; active nav item highlighted on each
- Mobile Sheet opens and closes correctly; all nav items navigable
- Sign Out from sidebar footer works end-to-end; car CRUD and AI chat unchanged
