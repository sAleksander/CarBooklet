# Sidebar Navigation Implementation Plan

## Overview

Replace the per-page `Topbar.astro` horizontal nav with a persistent sidebar navigation on all protected pages. Introduce a new authenticated app shell (`AppLayout.astro`) that houses a server-rendered desktop sidebar and a React Sheet island for mobile. Every protected page swaps `<Layout>` for `<AppLayout>` and loses its manual Topbar import. `Topbar.astro` is deleted; `Welcome.astro` is cleaned up.

## Current State Analysis

The app has one layout (`src/layouts/Layout.astro`) — a bare HTML document shell with a single `<slot />` and zero navigation awareness. The `Topbar.astro` horizontal nav is manually imported and rendered by three of the four protected pages; `cars.astro` has no navigation at all, making it an orphaned screen. There is no active-route highlighting anywhere.

Every protected page follows this composition pattern inside `<Layout>`:
```
<div class="bg-cosmic min-h-screen p-4">
  <Topbar />
  <div class="flex justify-center pt-8">
    <div class="w-full max-w-2xl/3xl ...glassmorphism card...">
      <!-- page content -->
    </div>
  </div>
</div>
```

The new layout restructures this into a horizontal split: sidebar column (fixed ~240 px) + scrollable main area. The `bg-cosmic` full-screen div moves from each page into `AppLayout.astro`.

## Desired End State

On every protected route (`/dashboard`, `/entries`, `/ai-chat`, `/cars`):
- A persistent left sidebar is visible on desktop (≥ md breakpoint)
- The sidebar contains: car-switcher widget at top, three nav items (Dashboard, Entries, AI Chat), user email + Sign Out at the bottom
- The active nav item is visually highlighted (based on current `pathname`)
- On mobile (< md): sidebar is hidden; a hamburger button in a top bar opens the sidebar as a Sheet overlay
- `/cars` is no longer a navigation-less orphan — it has the full sidebar chrome

### Key Discoveries

- `src/layouts/Layout.astro` — 50-line bare document shell; no nav, no auth; used unchanged by public pages (auth forms, landing)
- `src/components/Topbar.astro` — authenticated branch (Dashboard/Entries/AI Chat/Sign Out) becomes dead code after migration; unauthenticated branch (sign-in/sign-up) currently used by `Welcome.astro` → that dependency is removed in Phase 4
- `src/pages/dashboard.astro:35–37` — wraps in `bg-cosmic min-h-screen p-4`, renders `<Topbar />`; has `car` object from `getCarById` call → passes to AppLayout as `selectedCar`
- `src/pages/entries.astro:40–42` — same pattern; has `car` from `getCarById` at line 28
- `src/pages/ai-chat.astro:27–29` — same pattern; has `car` from `getCarById` at line 20
- `src/pages/cars.astro` — 14 lines, no navigation, no `bg-cosmic`, just `<CarList client:load>`; passes no `selectedCar`
- `src/components/Welcome.astro:28` — renders `<Topbar />` inside `bg-cosmic` landing page; hero already has Sign In/Sign Up buttons inline, so removing Topbar leaves the page intact
- shadcn CSS vars `--sidebar-*` seeded in `src/styles/global.css` but default to near-white light values → must be overridden to dark/cosmic values
- `src/types.ts` exports `Car` type — use for `selectedCar` prop type across AppLayout/Sidebar
- `lucide-react` installed and in use; available for sidebar icons (optional — no icon requirement in PRD)

## What We're NOT Doing

- No desktop collapse / icon-only mode — sidebar is always full-width on desktop
- No bottom navigation bar on mobile — using hamburger + Sheet overlay only
- No changes to `src/middleware.ts` or `PROTECTED_ROUTES`
- No changes to any API endpoints or database layer
- No changes to auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) or their layouts
- No changes to `src/pages/index.astro` — it already redirects authenticated users to `/dashboard`
- No `/cars` item in the primary nav list — `/cars` is accessed via the car-switcher widget only
- No smoke-testing of FR-007/FR-008 functionality (car CRUD and AI chat backend correctness) — PRD risk note says they must be verified, but that's manual regression testing, not new implementation

## Implementation Approach

**New `AppLayout.astro`** wraps `Layout.astro` and provides the authenticated app shell. It reads `user` and `pathname` from `Astro.locals` / `Astro.url` — no prop drilling from pages for auth state.

**Two sidebar components:**
- `AppSidebar.astro` — fully server-rendered desktop sidebar. Receives `pathname`, `userEmail`, and optional `selectedCar` as props. Uses shadcn CSS vars directly for styling. Handles active-state via `pathname.startsWith(item.href)`.
- `MobileSidebarTrigger.tsx` — a minimal React island (`client:load`). Renders a hamburger `Button` and a `Sheet` containing the same nav items. The Sheet handles backdrop, animation, and focus trap natively.

**Shared nav config** lives in `src/lib/nav.ts` — a single source of truth for the three nav items, imported by both sidebar components. Prevents duplication.

**Migration of pages** is mechanical: swap `<Layout>` for `<AppLayout>`, remove the `bg-cosmic` outer `<div>` + `<Topbar />`, pass `selectedCar={car}` where the car is already loaded. The inner content structure (glassmorphism card, max-width constraints) remains unchanged on each page.

## Critical Implementation Details

**AppLayout height model:** The sidebar must be full-height and not scroll with the page. AppLayout's outer container uses `h-screen overflow-hidden` so that only the `<main>` scrolls. The main content area uses `flex-1 overflow-auto`. Without this, the sidebar will either overflow or the whole page will scroll as one unit.

**`user` non-null assumption in AppLayout:** Middleware guarantees `user` is set on all PROTECTED_ROUTES before AppLayout ever renders. TypeScript still sees `User | null` from the `App.Locals` type declaration. Use `user?.email ?? ""` rather than a non-null assertion to satisfy the type checker without needing a runtime guard.

**`pt-8` removal in migrated pages:** The existing pages add `pt-8` to their content container to push content below the Topbar. Once `AppLayout`'s `<main>` provides its own padding, this extra top padding can be removed or reduced. Verify visually per page.

---

## Phase 1: Install shadcn packages and override sidebar CSS vars

### Overview

Install the four shadcn components needed for the sidebar and update the CSS custom properties so the sidebar renders in the app's dark cosmic style rather than shadcn's default light palette.

### Changes Required

#### 1. Install shadcn packages

**Command to run**: `npx shadcn@latest add sidebar sheet scroll-area separator`

**Intent**: Add the shadcn components that the sidebar will use. `sidebar` provides the core structural primitives; `sheet` is the mobile overlay container; `scroll-area` wraps the sidebar's nav list if content overflows; `separator` draws dividers between sidebar sections.

**Contract**: Creates or updates `src/components/ui/sidebar.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/scroll-area.tsx`, `src/components/ui/separator.tsx`. May also add import/type declarations to `src/components/ui/utils.ts` or `global.css` — review the diff before committing.

#### 2. Override `--sidebar-*` CSS custom properties

**File**: `src/styles/global.css`

**Intent**: The installed shadcn vars default to a near-white light palette (`--sidebar: oklch(0.985 0 0)`). Override them in `:root` to use dark values consistent with the app's `bg-cosmic` dark gradient aesthetic.

**Contract**: Update the 8 `--sidebar-*` properties in the `:root` block to low-lightness OKLCH values: dark background with a slight blue/purple tint for `--sidebar`; near-white for `--sidebar-foreground`; a semi-transparent white accent (`oklch(1 0 0 / 0.08)`) for `--sidebar-accent` matching the app's `bg-white/10` pattern; `oklch(1 0 0 / 0.1)` for `--sidebar-border` matching `border-white/10`. The `.dark` overrides for these vars can be removed — the app does not use a dark-mode toggle.

### Success Criteria

#### Automated Verification

- All four packages install without peer-dependency errors
- `npm run build` succeeds after installation
- `npm run lint` passes

#### Manual Verification

- The four new `src/components/ui/*.tsx` files exist
- Opening `src/styles/global.css`, the `--sidebar-*` vars in `:root` read as dark OKLCH values, not the original near-white defaults

---

## Phase 2: Build AppSidebar and MobileSidebarTrigger

### Overview

Create the two sidebar components and the shared nav configuration they both consume. The desktop sidebar is a server-rendered Astro component; the mobile trigger is a React island.

### Changes Required

#### 1. Shared nav item configuration

**File**: `src/lib/nav.ts` *(new)*

**Intent**: Centralise the three primary nav items so they are defined once and imported by both `AppSidebar.astro` and `MobileSidebarTrigger.tsx`, preventing the nav list from drifting out of sync.

**Contract**: Export a `const NAV_ITEMS` array with shape `{ href: string; label: string }[]` covering Dashboard (`/dashboard`), Entries (`/entries`), AI Chat (`/ai-chat`). Mark it `as const`.

#### 2. Desktop sidebar component

**File**: `src/components/AppSidebar.astro` *(new)*

**Intent**: Server-rendered sidebar column for desktop. Reads `pathname` to compute active state; shows car-switcher, nav items, and user+sign-out footer.

**Contract**:
- Props interface: `{ pathname: string; userEmail: string; selectedCar?: Car }` — import `Car` from `@/types`
- Renders as an `<aside>` with fixed width (~240 px), full height, and `bg-[var(--sidebar)]` background, `border-r border-[var(--sidebar-border)]`
- **Car-switcher section** (sidebar header): an `<a href="/cars">` that displays `${selectedCar.brand} ${selectedCar.model}` when `selectedCar` is provided, or `"Select a car"` otherwise. Styled as a compact card/button.
- **Nav list** (sidebar body): maps over `NAV_ITEMS`, each item is an `<a>` with active classes applied when `pathname.startsWith(item.href)`. Active item uses `bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]`; inactive uses `text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]`.
- **Footer**: user email in `<p class="truncate text-xs ...">` + a `<form method="POST" action="/api/auth/signout">` with a sign-out `<button>`.

#### 3. Mobile sidebar trigger component

**File**: `src/components/MobileSidebarTrigger.tsx` *(new)*

**Intent**: React island rendering a hamburger button that opens a Sheet containing the same navigation. This is the only interactive sidebar code; it runs `client:load`.

**Contract**:
- Props interface mirrors AppSidebar: `{ pathname: string; userEmail: string; selectedCar?: Car }` — import `Car` from `@/types`
- Imports: `Sheet`, `SheetContent`, `SheetTrigger`, `SheetHeader`, `SheetTitle` from `@/components/ui/sheet`; `Button` from `@/components/ui/button`; `Menu` from `lucide-react`; `NAV_ITEMS` from `@/lib/nav`; `cn` from `@/lib/utils`
- `SheetTrigger`: a ghost `Button` with `<Menu>` icon and `sr-only` label
- `SheetContent`: `side="left"`, `w-60`, uses `bg-[var(--sidebar)]` — renders the same car-switcher, nav list, and footer structure as `AppSidebar.astro`. Active-state logic is identical (`pathname.startsWith(item.href)`)
- `SheetTitle` must be present (required by accessibility) — can be `sr-only` ("Navigation")

### Success Criteria

#### Automated Verification

- `npm run build` succeeds
- `npm run lint` passes (no unused imports, no TypeScript errors)

#### Manual Verification

- Temporarily add `<AppSidebar pathname="/dashboard" userEmail="test@example.com" />` to any page and confirm it renders as a dark sidebar column
- Temporarily add `<MobileSidebarTrigger client:load pathname="/dashboard" userEmail="test@example.com" />` and confirm the hamburger button opens a Sheet with nav items
- Remove temporary test additions before moving to Phase 3

---

## Phase 3: Create AppLayout shell

### Overview

Introduce the `AppLayout.astro` authenticated app shell. It wraps `Layout.astro`, mounts both sidebar components, and provides the `bg-cosmic` full-screen container. Protected pages will use this instead of `Layout.astro`.

### Changes Required

#### 1. Authenticated app shell layout

**File**: `src/layouts/AppLayout.astro` *(new)*

**Intent**: Single location for the dark cosmic wrapper, sidebar mount, and page-content slot for all authenticated pages. Desktop shows sidebar + main column; mobile shows a compact top bar with the hamburger trigger + the main column.

**Contract**:
- Props interface: `{ title?: string; selectedCar?: Car }` — import `Car` from `@/types`
- Reads `pathname` from `Astro.url.pathname`; reads `user` from `Astro.locals`; passes `user?.email ?? ""` as `userEmail` to sidebar components
- **Outer wrapper**: `<div class="bg-cosmic flex h-screen overflow-hidden">` — owns the cosmic background and prevents the full page from scrolling
- **Desktop sidebar**: `<AppSidebar>` wrapped in `<div class="hidden md:flex">` — hidden on mobile
- **Main column**: `<div class="flex flex-1 flex-col overflow-hidden">`
  - **Mobile top bar** `<header class="flex md:hidden items-center gap-3 border-b border-white/10 px-4 py-3">`: `<MobileSidebarTrigger client:load ...>` + `<span>` showing `title`
  - **Content area** `<main class="flex-1 overflow-auto p-4">`: `<slot />`
- Passes `Layout.astro` the same `title` prop so `<title>` in `<head>` is correct

### Success Criteria

#### Automated Verification

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification

- Temporarily use `<AppLayout title="Test" />` on one protected page (e.g., `/dashboard`)
- Desktop: sidebar visible on the left at ~240 px, content scrolls normally, `bg-cosmic` applied to the full screen
- Mobile (DevTools responsive mode, < md breakpoint): sidebar hidden, hamburger button visible in top bar; tapping hamburger opens Sheet; tapping a nav link navigates and Sheet closes

**Implementation Note**: After completing Phase 3 and the manual verification above passes on the test page, pause for confirmation before proceeding to the full migration in Phase 4.

---

## Phase 4: Migrate protected pages and clean up Topbar

### Overview

Swap all four protected pages from `Layout` to `AppLayout`, remove the manual `Topbar` imports and `bg-cosmic` wrappers, update `Welcome.astro` to remove its Topbar dependency, and delete `Topbar.astro`.

### Changes Required

#### 1. Migrate `dashboard.astro`

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the Layout+Topbar shell with AppLayout; pass the already-loaded `car` as `selectedCar`.

**Contract**: Remove `import Layout` and `import Topbar`. Add `import AppLayout`. Replace `<Layout title={...}>` with `<AppLayout title={...} selectedCar={car}>`. Remove the outer `<div class="bg-cosmic min-h-screen p-4">` and `<Topbar />`. Keep all inner content structure. Review the `pt-8` on the centering wrapper (may want to reduce to `pt-4` or remove since AppLayout's `<main>` provides `p-4`).

#### 2. Migrate `entries.astro`

**File**: `src/pages/entries.astro`

**Intent**: Same migration as dashboard; `car` is already in scope from the existing `getCarById` call.

**Contract**: Same swap as dashboard. Pass `selectedCar={car}`. Remove outer `bg-cosmic` wrapper and `<Topbar />`. The ai-chat.astro title currently hardcodes `"AI Chat"` — entries uses `${car.brand} ${car.model} — Entries` as the title, retain that. Review `pt-8`.

#### 3. Migrate `ai-chat.astro`

**File**: `src/pages/ai-chat.astro`

**Intent**: Same migration; `car` is already in scope.

**Contract**: Same swap. Pass `selectedCar={car}`. The page title is currently `"AI Chat"` — retain. Remove outer `bg-cosmic` wrapper and `<Topbar />`. Review `pt-8`.

#### 4. Migrate `cars.astro`

**File**: `src/pages/cars.astro`

**Intent**: Give the car-management page the same navigation chrome as all other protected pages. No `selectedCar` prop — user is on the car selection screen.

**Contract**: Replace `import Layout` with `import AppLayout`. Replace `<Layout title="My Cars">` with `<AppLayout title="My Cars">`. No `selectedCar` prop — the car-switcher in the sidebar will show "Select a car". `<CarList client:load ...>` becomes the slot content directly.

Note: `CarList` renders a `<div className="space-y-6 p-4">` as its root element — it is content-only with no full-screen layout assumptions. It will slot cleanly into AppLayout's `<main>` area.

#### 5. Remove Topbar from `Welcome.astro`

**File**: `src/components/Welcome.astro`

**Intent**: `Welcome.astro` used `<Topbar />` for its unauthenticated sign-in/sign-up nav bar. The hero section already contains prominent Sign In and Sign Up CTA buttons, so the nav bar is redundant and can simply be removed.

**Contract**: Remove the `import Topbar` statement (line 2) and the `<Topbar />` element (line 28). No replacement is needed — the hero's sign-in and sign-up `<a>` elements remain intact.

#### 6. Delete `Topbar.astro`

**File**: `src/components/Topbar.astro`

**Intent**: No page imports `Topbar` after step 5. Delete the file to complete the cleanup.

**Contract**: File deleted. Verify with `grep -r "Topbar" src/` that no remaining imports exist before deleting.

### Success Criteria

#### Automated Verification

- `grep -r "Topbar" src/` returns no results
- `npm run build` succeeds with no TypeScript errors
- `npm run lint` passes

#### Manual Verification

- `/dashboard`, `/entries`, `/ai-chat`, `/cars` all render with the sidebar visible; each page loads without JS errors
- Active-state: navigating to each route highlights the correct nav item
- Car-switcher: shows the selected car's brand+model on dashboard/entries/ai-chat; shows "Select a car" on /cars
- User email visible in sidebar footer; Sign Out button signs the user out and redirects to `/`
- Mobile: hamburger button opens Sheet with correct nav items on all four routes; Sheet closes on link tap
- Sign In and Sign Up still appear on the landing page (`/`) after Topbar removal from Welcome.astro
- Car CRUD on `/cars` still works (add, edit, delete, select — smoke test FR-007)
- AI chat on `/ai-chat` still streams responses (smoke test FR-008)

**Implementation Note**: After completing Phase 4 and all automated verification passes, run a full manual smoke test across all four routes before marking this change complete.

---

## Testing Strategy

### Automated Verification

- `npm run build` after each phase
- `npm run lint` for TypeScript correctness
- `grep -r "Topbar" src/` returns zero matches after Phase 4

### Manual Testing Steps

1. Sign in with a valid account
2. Visit `/dashboard` — sidebar visible, Dashboard item highlighted, car name in switcher
3. Visit `/entries` — Entries item highlighted, same car name
4. Visit `/ai-chat` — AI Chat item highlighted, stream a message to confirm chat works
5. Visit `/cars` — sidebar visible, "Select a car" in switcher, car CRUD works (add car, edit, delete, select)
6. Click car-switcher widget — navigates to `/cars`
7. On mobile viewport (375 px): hamburger visible on all four routes, Sheet opens/closes correctly
8. Sign Out from sidebar footer — redirected to `/`, landing page shows cosmic hero with Sign In/Sign Up CTAs
9. Sign out state: visit `/dashboard` directly → redirected to `/auth/signin` (middleware still works)

## References

- Research: `context/changes/sidebar-navigation/research.md`
- PRD requirements: `context/foundation/prd-v2.md:94–101` (FR-002, FR-003, FR-004)
- Roadmap slice: `context/foundation/roadmap.md:33,77–88` (S-02, status: ready)
- Current layout: `src/layouts/Layout.astro`
- Current nav: `src/components/Topbar.astro`
- Protected pages: `src/pages/dashboard.astro:35`, `src/pages/entries.astro:40`, `src/pages/ai-chat.astro:27`
- CSS vars: `src/styles/global.css` (`--sidebar-*`)
- shadcn sidebar: `npx shadcn@latest add sidebar`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Install shadcn packages and override sidebar CSS vars

#### Automated

- [x] 1.1 All four packages install without peer-dependency errors
- [x] 1.2 `npm run build` succeeds after installation
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 The four new `src/components/ui/*.tsx` files exist
- [x] 1.5 `--sidebar-*` vars in `global.css` `:root` read as dark OKLCH values

### Phase 2: Build AppSidebar and MobileSidebarTrigger

#### Automated

- [ ] 2.1 `npm run build` succeeds
- [ ] 2.2 `npm run lint` passes (no unused imports, no TypeScript errors)

#### Manual

- [ ] 2.3 `AppSidebar.astro` renders as a dark sidebar column on a test page
- [ ] 2.4 `MobileSidebarTrigger.tsx` opens a Sheet with nav items when hamburger is clicked

### Phase 3: Create AppLayout shell

#### Automated

- [ ] 3.1 `npm run build` succeeds
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Desktop: sidebar visible, content scrolls independently, `bg-cosmic` applied full-screen
- [ ] 3.4 Mobile: hamburger in top bar, Sheet opens/closes, nav link navigates correctly

### Phase 4: Migrate protected pages and clean up Topbar

#### Automated

- [ ] 4.1 `grep -r "Topbar" src/` returns no results
- [ ] 4.2 `npm run build` succeeds with no TypeScript errors
- [ ] 4.3 `npm run lint` passes

#### Manual

- [ ] 4.4 All four protected routes render with sidebar and correct active-state
- [ ] 4.5 Car-switcher shows car name on dashboard/entries/ai-chat; "Select a car" on /cars
- [ ] 4.6 User email + Sign Out visible in sidebar footer; sign-out works end-to-end
- [ ] 4.7 Mobile Sheet works on all four routes
- [ ] 4.8 Landing page (`/`) still shows Sign In/Sign Up CTAs after Topbar removal
- [ ] 4.9 Car CRUD smoke test: add, edit, delete, select a car on `/cars`
- [ ] 4.10 AI chat smoke test: message streams correctly on `/ai-chat`
