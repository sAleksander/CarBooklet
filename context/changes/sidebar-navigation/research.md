---
date: 2026-06-09T07:12:34Z
researcher: Aleksander
git_commit: fd7cf01668cb672e474463a05d135df5bfa37cad
branch: main
repository: CarBooklet
topic: "Sidebar navigation — architecture & layout deep dive"
tags: [research, sidebar, navigation, layout, app-shell, astro, shadcn]
status: complete
last_updated: 2026-06-09
last_updated_by: Aleksander
---

# Research: Sidebar Navigation — Architecture & Layout

**Date**: 2026-06-09T07:12:34Z
**Researcher**: Aleksander
**Git Commit**: fd7cf01668cb672e474463a05d135df5bfa37cad
**Branch**: main
**Repository**: CarBooklet

## Research Question

What is the current app shell and layout architecture, what routes and pages exist, and what is needed to add a sidebar navigation to all protected pages?

## Summary

The app has four protected pages (`/dashboard`, `/cars`, `/entries`, `/ai-chat`) and a minimal layout with no shared navigation. A horizontal `Topbar.astro` component is manually imported by each page — but `cars.astro` includes no navigation at all, leaving it orphaned. The sidebar is explicitly required by PRD v2 (FR-002, FR-003, FR-004, all must-have) and sits at roadmap position S-02 (status: `ready`).

The critical architectural decision for this change is creating a new **authenticated app shell layout** (e.g., `AppLayout.astro`) that houses the sidebar, rather than surgically replacing `Topbar` in each page. The shadcn sidebar CSS variables are already seeded in `global.css`; the `sidebar.tsx` shadcn component just needs to be added via CLI.

## Detailed Findings

### Current Route Inventory

**Public routes (no auth required):**
| Route | File |
|-------|------|
| `/` | `src/pages/index.astro` — redirects to `/dashboard` if authenticated |
| `/auth/signin` | `src/pages/auth/signin.astro` |
| `/auth/signup` | `src/pages/auth/signup.astro` |
| `/auth/confirm-email` | `src/pages/auth/confirm-email.astro` |

**Protected routes (PROTECTED_ROUTES in middleware):**
| Route | File | Currently Has Topbar? |
|-------|------|-----------------------|
| `/dashboard` | `src/pages/dashboard.astro` | Yes (manual, line 37) |
| `/entries` | `src/pages/entries.astro` | Yes (manual, line 43) |
| `/ai-chat` | `src/pages/ai-chat.astro` | Yes (manual, line 30) |
| `/cars` | `src/pages/cars.astro` | **No — navigation-less orphan** |

`cars.astro` is in `PROTECTED_ROUTES` and requires auth but renders only `<CarList client:load />` with no surrounding navigation. Users have no visible way to leave the car-selection screen other than the browser back button.

### Layout Architecture

There is exactly **one layout file**: `src/layouts/Layout.astro`. It is a bare HTML shell — it accepts a `title?: string` prop, renders a global CSS import and a config-status banner, and exposes a single unnamed `<slot />`. It contains **zero navigation, zero auth awareness**.

The `Topbar.astro` component self-sources auth state from `Astro.locals.user` (set by middleware) — no prop drilling needed. It renders:
- **Authenticated**: user email · `/dashboard` · `/entries` · `/ai-chat` · Sign Out
- **Unauthenticated**: "Not signed in" · `/auth/signin` · `/auth/signup`

Notable gaps in current Topbar:
1. **No `/cars` link** — the car-selection page is unreachable from the top nav
2. **No active-route highlighting** — all links use identical static classes; `Astro.url.pathname` is never read

### Auth State Threading

Full chain: `src/middleware.ts` → `context.locals.user` (User | null) + `context.locals.selectedCarId` (string | null from cookie `selected_car_id`) → each page's `Astro.locals` → `Topbar.astro` reads directly from `Astro.locals`. No prop drilling is needed for the sidebar either.

Protected page redirects: unauthenticated requests to any PROTECTED_ROUTES path redirect to `/auth/signin` (middleware.ts:24). Per-page secondary checks verify `selectedCarId` cookie and car ownership for `/dashboard`, `/entries`, `/ai-chat`.

### Current Per-Page Composition Pattern

All authenticated pages follow this pattern inside `<Layout>`:

```astro
<Layout title="...">
  <div class="bg-cosmic min-h-screen p-4">
    <Topbar />
    <div class="flex justify-center pt-8">
      <div class="w-full max-w-2xl/3xl rounded-2xl border border-white/10 bg-white/10 p-8 text-white backdrop-blur-xl">
        <!-- page content -->
      </div>
    </div>
  </div>
</Layout>
```

The sidebar change must restructure this pattern: the `bg-cosmic` full-screen div becomes a flex row (`sidebar | main-content`), and the content area adjusts its padding for sidebar width. The glassmorphism card style (`border-white/10 bg-white/10 backdrop-blur-xl`) should be preserved as the content-card visual language.

### PRD Requirements for This Change

From `context/foundation/prd-v2.md` and `context/foundation/shape-notes.md`:

- **FR-002** (prd-v2.md:94–95): Responsive sidebar on all protected pages, visible links to Dashboard, Entries, AI Chat. **Priority: must-have.**
- **FR-003** (prd-v2.md:96–98): Active-state indicator showing current section. **Priority: must-have.**
- **FR-004** (prd-v2.md:100–101): Mobile-friendly collapse (hamburger or bottom nav — implementation decision). **Priority: must-have.**

Explicit product note: sidebar was confirmed over top navbar during shaping. `/cars` is not listed in FR-002's "major sections" (Dashboard, Entries, AI Chat) — it is a utility screen, not a primary nav destination. The plan should decide whether Cars appears in sidebar or has its own entry point.

### Roadmap Slice S-02

From `context/foundation/roadmap.md`:

- **Change ID**: `sidebar-navigation` (matches this change folder) — roadmap.md:33,77
- **Status**: `ready` — roadmap.md:33
- **Outcome**: "user can navigate between all major sections (Dashboard, Entries, AI Chat) on any protected page via a responsive sidebar; the sidebar shows an active-state indicator for the current section at all times; on small screens the sidebar collapses to a mobile-friendly navigation pattern" — roadmap.md:79
- **PRD refs**: FR-002, FR-003, FR-004, FR-007, FR-008 — roadmap.md:33

**Risk note** (roadmap.md:88): touches every protected page — FR-007 (car CRUD) and FR-008 (AI chat backend) must be smoke-tested after this slice ships.

**Downstream slices unlocked by S-02:**
- **S-03** (`entry-detail-route`, `proposed`): adds `/entries/[id]`, must be added to PROTECTED_ROUTES
- **S-04** (`dashboard-last-entry`, `proposed`): adds "most recent entry" widget to `/dashboard`

### UI Component Inventory

**shadcn components already installed** (`src/components/ui/`):
- `button.tsx` — CVA variants (default, destructive, outline, secondary, ghost, link)
- `dialog.tsx`, `alert-dialog.tsx` — modal patterns
- `select.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx` — form primitives

**shadcn components needed for sidebar** (not yet installed):
- `sidebar.tsx` — core structural shell (`npx shadcn@latest add sidebar`)
- `scroll-area.tsx` — scrollable sidebar content (`npx shadcn@latest add scroll-area`)
- `separator.tsx` — visual dividers (`npx shadcn@latest add separator`)
- `tooltip.tsx` — hover hints for collapsed icon mode (`npx shadcn@latest add tooltip`)

**CSS design tokens — sidebar vars already present** in `src/styles/global.css`:
```css
--sidebar, --sidebar-foreground, --sidebar-primary, --sidebar-primary-foreground,
--sidebar-accent, --sidebar-accent-foreground, --sidebar-border, --sidebar-ring
```
These are seeded by the 10x-astro-starter template and will wire up automatically once `sidebar.tsx` is added.

**Icons**: `lucide-react` is installed and in use across 5+ components. Sidebar nav icons (e.g. `LayoutDashboard`, `BookOpen`, `MessageSquare`, `Car`, `LogOut`) are available without adding a dependency.

**`cn()` utility**: present at `src/lib/utils.ts` (alias `@/lib/utils`).

## Code References

- `src/middleware.ts:4` — PROTECTED_ROUTES definition
- `src/middleware.ts:24` — redirect unauthenticated users to `/auth/signin`
- `src/layouts/Layout.astro` — single layout file, bare HTML shell, no navigation
- `src/components/Topbar.astro:2` — reads `Astro.locals.user` directly
- `src/pages/dashboard.astro:37` — manual `<Topbar />` render
- `src/pages/entries.astro:43` — manual `<Topbar />` render
- `src/pages/ai-chat.astro:30` — manual `<Topbar />` render
- `src/pages/cars.astro` — NO Topbar, navigation-less
- `src/styles/global.css:113–115` — `@utility bg-cosmic` definition
- `context/foundation/prd-v2.md:94–101` — FR-002, FR-003, FR-004 sidebar requirements
- `context/foundation/roadmap.md:33,77–88` — S-02 sidebar-navigation slice definition

## Architecture Insights

### Recommended approach: new `AppLayout.astro`

Rather than modifying each page individually, introduce a new `src/layouts/AppLayout.astro` that wraps `Layout.astro` and provides the authenticated app shell (sidebar + main content area). Protected pages swap `<Layout>` for `<AppLayout>`. This:
- Keeps `Layout.astro` as a pure document shell (auth pages, landing page continue using it unchanged)
- Provides a single place to maintain the sidebar and app chrome
- Eliminates the per-page Topbar import pattern and the `cars.astro` nav gap
- Allows `Astro.url.pathname` to be read once in `AppLayout.astro` for active-state highlighting

`AppLayout.astro` would pass the current pathname to a sidebar component (Astro or React), which uses it to determine the active link.

### Sidebar implementation options

**Option A — shadcn `sidebar.tsx` (Astro wrapper)**
- Install `sidebar.tsx` via `npx shadcn@latest add sidebar`
- Wrap it in `src/components/Sidebar.astro` for SSR (reads `Astro.locals.user` and `Astro.url.pathname`)
- Pros: CSS vars already seeded, consistent with existing shadcn pattern, handles mobile sheet via built-in Sheet component
- Cons: shadcn's sidebar is a heavy React component — needs `client:load` or a hybrid approach

**Option B — custom Astro component**
- Build `src/components/Sidebar.astro` from scratch using Tailwind + lucide-react
- SSR-friendly, no React needed for the static sidebar structure
- Mobile collapse requires a small JS island (hamburger toggle)
- Pros: lighter, fully server-rendered by default; Cons: more work to match shadcn quality

Given the existing shadcn investment and the CSS var pre-seeding, Option A (shadcn sidebar) is the natural fit. The mobile sheet overlay is already handled by shadcn's Sheet component.

### Active-route detection pattern

Astro exposes `Astro.url.pathname` in any `.astro` file. A sidebar component can compare each nav item's `href` against `pathname` to apply active classes:

```astro
---
const { pathname } = Astro.url;
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/entries",   label: "Entries",   icon: "BookOpen" },
  { href: "/ai-chat",   label: "AI Chat",   icon: "MessageSquare" },
];
---
{navItems.map(item => (
  <a href={item.href} class:list={[
    "nav-link",
    pathname.startsWith(item.href) && "active"
  ]}>...</a>
))}
```

### `/cars` navigation decision

`/cars` is currently absent from `Topbar` and from PRD FR-002's explicit section list. Two patterns are common:
1. **Sidebar item**: "My Cars" as a navigation destination — simple, consistent
2. **Global car-switcher**: a persistent "selected car" widget in the sidebar header/footer, with a link to `/cars` to change it — more prominent UX since every action in the app is scoped to a selected car

The PRD does not prescribe which pattern. This is an open question for the plan.

## Historical Context (from prior changes)

- `context/changes/root-routing-landing/plan.md` — established the per-page redirect pattern at `/` (auth-aware landing) and the middleware PROTECTED_ROUTES structure. Topbar was already present at that point and treated as a given.
- `context/foundation/roadmap.md` — S-02 (`sidebar-navigation`) is listed as the second slice of the UI Glowup phase, explicitly after S-01 (`root-routing-landing`) which has already shipped. S-02 is `ready`.

## Open Questions

1. **Does `/cars` appear in the sidebar nav?** PRD FR-002 lists Dashboard, Entries, AI Chat — but `/cars` is a protected route and currently has no navigation. Two patterns: full nav item vs. persistent car-switcher widget in the sidebar shell.

2. **Mobile collapse pattern**: hamburger (Sheet overlay) or bottom nav? PRD FR-004 defers this to implementation. shadcn's sidebar handles the Sheet pattern out of the box.

3. **New `AppLayout.astro` vs modify `Layout.astro`?** New layout is strongly preferred (keeps public/auth shells separate), but the plan should confirm explicitly.

4. **Does `Topbar.astro` get deleted or kept for public pages?** The landing page (`index.astro` via `Welcome.astro`) currently uses Topbar to show sign-in/sign-up links. If `Welcome.astro` keeps using Topbar for the unauthenticated state, it can stay. The plan needs to clarify.

5. **`bg-cosmic` placement**: currently applied per-page on the outer div. In the new app shell, `AppLayout.astro` would own this, removing it from individual pages.
