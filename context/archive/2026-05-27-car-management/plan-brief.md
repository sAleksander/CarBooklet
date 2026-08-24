# Car Management — Plan Brief

> Full plan: `context/changes/car-management/plan.md`

## What & Why

Build full car CRUD (add, view, edit, delete, select) on a dedicated `/cars` page. This is S-01 — the north-star prerequisite. Without a selected car, the AI chat (S-02) has no context, and entry logging (S-03/S-04) has no target. The `selected_car_id` HttpOnly cookie established here is the cross-slice contract that S-02 through S-06 all consume.

## Starting Point

`cars` table + TypeScript types are live from F-01. The SSR Supabase client, middleware pattern, and API route pattern are all established. Only `src/components/ui/button.tsx` exists in shadcn — additional components needed.

## Desired End State

- `/cars` (protected): list all cars with select/edit/delete per card + add form; selected car visually highlighted.
- `/dashboard`: redirects to `/cars` when no car is selected; shows selected car's brand/model/year otherwise.
- `selected_car_id` HttpOnly cookie: set by `POST /api/cars/[id]/select`, cleared on delete, read by middleware into `context.locals.selectedCarId`.
- Five API endpoints (GET list, POST create, PATCH update, DELETE, POST select) with JSON responses and zod validation.

## Key Decisions Made

| Decision                 | Choice                                        | Why (1 sentence)                                                               |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Selected car storage     | HttpOnly cookie (`selected_car_id`)           | SSR-readable without extra DB fetch; consistent with cookie-based auth pattern |
| Landing page after login | `/dashboard` (redirects to `/cars` if no car) | Dashboard stays the user's home; `/cars` is the onboarding funnel              |
| Edit car                 | Included in S-01                              | Complete CRUD prevents frustrating typo-correction gap                         |
| Delete confirmation      | Required (AlertDialog)                        | Cascade-deletes future entries — unrecoverable                                 |
| Car switcher location    | `/cars` page + dashboard (not Topbar)         | Mobile-first: Topbar is too narrow; `/cars` is the natural management hub      |
| Form layout              | Single-page, all 9 fields                     | No wizard state overhead for a 9-field form                                    |
| Error handling           | Inline error on form/action                   | Contextual; uses shadcn component model                                        |
| API response format      | JSON (not FormData + redirect)                | React components call these endpoints via `fetch()`                            |

## Scope

**In scope:**

- `src/env.d.ts` — add `selectedCarId` to `App.Locals`
- `src/types.ts` — add `CarFormData`
- `src/lib/services/cars.ts` — CRUD service (getCars, getCarById, createCar, updateCar, deleteCar)
- `src/pages/api/cars/index.ts` — GET + POST
- `src/pages/api/cars/[id].ts` — PATCH + DELETE
- `src/pages/api/cars/[id]/select.ts` — POST (set cookie)
- `src/middleware.ts` — read `selected_car_id` cookie, add `/cars` to PROTECTED_ROUTES
- `src/components/cars/CarForm.tsx`
- `src/components/cars/DeleteCarDialog.tsx`
- `src/components/cars/CarList.tsx`
- `src/pages/cars.astro`
- `src/pages/dashboard.astro` — redirect + selected car display
- shadcn: `input`, `label`, `select`, `alert-dialog`

**Out of scope:** AI chat (S-02), entry logging (S-03/S-04), entry management (S-05), deadline dashboard (S-06), pagination, car sharing.

## Architecture / Approach

Three-phase delivery: backend-first (API + service + middleware), then UI (React components + Astro page), then dashboard integration. React components hydrate via `client:load` — initial data passed as props from server-side fetch to prevent flicker. All mutations call JSON API routes; after each mutation the component re-fetches the car list to stay in sync. RLS handles user isolation; no manual `WHERE user_id` filters needed.

## Phases at a Glance

| Phase                    | What it delivers                                  | Key risk                                                   |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| 1. Backend foundation    | 5 API routes + service + middleware update        | Stale cookie on delete must clear the cookie; easy to miss |
| 2. Car management UI     | `/cars` page with full interactive CRUD           | shadcn install must run before `npm run build`             |
| 3. Dashboard integration | Dashboard shows selected car; redirects when none | Stale-cookie guard (cookie points to deleted car)          |

**Prerequisites:** F-01 done (cars table live, types exported). Local Supabase running.  
**Estimated effort:** ~2 sessions (Phase 1 is the bulk; Phases 2–3 are incremental)

## Open Risks & Assumptions

- shadcn `alert-dialog` requires `@radix-ui/react-alert-dialog` — will install automatically via shadcn CLI
- `engine_type` Select in the form must match the `EngineType` union exactly (`"electric" | "gas" | "diesel" | "lpg"`)
- React components that call `fetch()` must handle `context.locals` being unavailable client-side — the selected car ID is passed as a prop from the Astro page (server-side) and managed in local state thereafter

## Success Criteria (Summary)

- All three phases: lint + build pass, manual scenarios confirmed
- Selected car cookie visible in DevTools after selecting a car
- Dashboard redirects to `/cars` when cookie absent; shows car info when present
