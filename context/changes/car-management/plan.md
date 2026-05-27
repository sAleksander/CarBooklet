# Car Management Implementation Plan

## Overview

Build full car CRUD — add, view, edit, delete, and select — on a dedicated `/cars` page. Establishes the `selected_car_id` cookie as the cross-slice selected-car contract that S-02 through S-06 all consume. Dashboard shows the currently selected car and redirects to `/cars` when no car is selected.

This is slice S-01. The `cars` table and TypeScript types from F-01 are already in place.

## Current State Analysis

- `public.cars` table with 13 columns, RLS, and `set_updated_at()` trigger is live (F-01 done).
- `src/types.ts` exports `Car` and `EngineType` — ready to import.
- `src/lib/supabase.ts` exports `createClient(requestHeaders, cookies)` — the SSR client factory used by all API routes and pages.
- `src/middleware.ts` resolves `context.locals.user` on every request; `PROTECTED_ROUTES = ["/dashboard"]`.
- `src/env.d.ts` declares `App.Locals { user }` — must add `selectedCarId`.
- Only `src/components/ui/button.tsx` exists in shadcn — input, label, select, alert-dialog must be installed.
- No `src/lib/services/` directory exists yet — will be created.
- No `src/components/cars/` directory exists yet — will be created.
- API routes in this project are called via React `fetch()` (not HTML form submissions) so they return JSON, not redirects. Auth routes use FormData + redirect — that pattern does not apply here.

## Desired End State

- `GET /api/cars` returns the authenticated user's car list as JSON.
- `POST /api/cars` creates a car (JSON body, zod-validated) and returns the created `Car`.
- `PATCH /api/cars/[id]` updates a car (JSON body, zod-validated) and returns the updated `Car`.
- `DELETE /api/cars/[id]` deletes a car; clears the `selected_car_id` cookie if the deleted car was selected.
- `POST /api/cars/[id]/select` sets `selected_car_id` cookie and returns `{ success: true }`.
- `/cars` is a protected page: car list with select/edit/delete per car, plus an add-car form. Selected car is visually highlighted.
- `/dashboard` redirects to `/cars` when no car is selected (cookie absent or stale); otherwise shows the selected car's brand, model, and year.
- `selected_car_id` cookie is the stable cross-slice contract — S-02 through S-06 read `context.locals.selectedCarId` from middleware.

## What We're NOT Doing

- No AI chat (S-02), no entry logging (S-03/S-04), no entry management (S-05), no dashboard (S-06).
- No car sharing or multi-user access (PRD Non-Goal).
- No VIN checksum validation (deferred per F-01 plan).
- No database-level validation of `engine_capacity` / `engine_power` format — text fields, frontend validates presence only.
- No pagination — user is expected to have 1–2 cars per roadmap persona.
- No server-side rendered React (all car components hydrate via `client:load`).

## Critical Implementation Details

- **`selected_car_id` cookie shape**: `{ name: "selected_car_id", value: "<uuid>", options: { path: "/", httpOnly: true, sameSite: "lax", maxAge: 31536000 } }`. `httpOnly: true` means JS cannot read it — that is intentional and correct; only the server (middleware, API routes) needs it. React components track selected state locally after server-side initial prop.
- **Stale cookie guard**: dashboard must verify the cookie's UUID still exists in the user's cars before rendering. If the car was deleted (cookie stale), redirect to `/cars`. This prevents a split-brain where the cookie points to a non-existent car.
- **RLS is the auth boundary**: service functions call Supabase with the user's session via `createClient`. The `user_id = auth.uid()` RLS policy ensures users can only read and mutate their own rows. No manual `WHERE user_id = ?` filter needed beyond what RLS enforces.
- **API routes return JSON for React callers**: unlike auth routes (FormData + redirect), these endpoints are called via `fetch()` from React components. Response format: `{ car: Car }` or `{ cars: Car[] }` on success, `{ error: string }` on failure. Status codes: 200/201 success, 400 validation, 401 unauthenticated, 404 not found, 500 server error.
- **Delete cascade**: `cars.user_id` has `ON DELETE CASCADE` to `auth.users`. When a car row is deleted, its future entries (S-03/S-04) will also cascade-delete — the confirmation dialog must mention this.
- **`set_updated_at()` trigger** (from F-01): already applied to `public.cars`; no code needed here.
- **shadcn components**: install with `npx shadcn@latest add input label select alert-dialog`. Do not add `form` component (RHF overhead not justified for this slice); use controlled React state directly.

---

## Phase 1: Backend foundation

### Overview

Extend `App.Locals` with `selectedCarId`, add `CarFormData` to `src/types.ts`, create the car service, wire all five API routes, and update middleware to read the selected-car cookie. No UI changes in this phase.

### Changes Required

#### 0. Install zod

Run: `npm install zod`

zod is not present in `package.json`. API routes in items 4 and 5 import from zod for request body validation. The build will fail without this step.

#### 1. `src/env.d.ts` — extend App.Locals

**File**: `src/env.d.ts`

**Intent**: Add `selectedCarId` so every Astro page and API route can read the selected car ID from `Astro.locals` / `context.locals` without casting.

**Contract**:

```typescript
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    selectedCarId: string | null;
  }
}
```

#### 2. `src/types.ts` — add CarFormData

**File**: `src/types.ts`

**Intent**: Typed DTO for car create/update payloads. Keeps API route and form component aligned without coupling to the full `Car` row shape.

**Contract** (append after existing exports):

```typescript
export interface CarFormData {
  brand: string;
  model: string;
  production_year: string;
  registration_number?: string | null;
  engine_type: EngineType;
  engine_capacity: string;
  engine_power: string;
  engine_code?: string | null;
  vin_number?: string | null;
}
```

#### 3. `src/lib/services/cars.ts` — CRUD service

**File**: `src/lib/services/cars.ts` (new)

**Intent**: Isolate all Supabase `cars` table operations. API routes call these functions; RLS handles user isolation automatically via the session-bound client.

**Contract**:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, CarFormData } from "@/types";

export async function getCars(supabase: SupabaseClient): Promise<Car[]>
export async function getCarById(supabase: SupabaseClient, id: string): Promise<Car | null>
export async function createCar(supabase: SupabaseClient, data: CarFormData): Promise<Car>
export async function updateCar(supabase: SupabaseClient, id: string, data: Partial<CarFormData>): Promise<Car>
export async function deleteCar(supabase: SupabaseClient, id: string): Promise<void>
```

Each function throws an `Error` with the Supabase error message on DB failure. Callers catch and return 500.

#### 4. `src/pages/api/cars/index.ts` — list + create

**File**: `src/pages/api/cars/index.ts` (new)

**Intent**: `GET` returns the user's car list. `POST` creates a car with zod validation.

**Contract**:

```
GET /api/cars
  → 200 { cars: Car[] }
  → 401 { error: "Unauthorized" }
  → 500 { error: string }

POST /api/cars
  Body: CarFormData (JSON)
  → 201 { car: Car }
  → 400 { error: string }  (zod validation failure)
  → 401 { error: "Unauthorized" }
  → 500 { error: string }
```

Zod schema (`carSchema`) validates all fields. `brand`, `model`, `production_year`, `engine_type`, `engine_capacity`, `engine_power` are required non-empty strings. Optional fields (`registration_number`, `engine_code`, `vin_number`) default to `null` when absent. `engine_type` validated as `z.enum(["electric", "gas", "diesel", "lpg"])`.

#### 5. `src/pages/api/cars/[id].ts` — update + delete

**File**: `src/pages/api/cars/[id].ts` (new)

**Intent**: `PATCH` updates a car's fields. `DELETE` removes it and clears the selected-car cookie if it pointed to this car.

**Contract**:

```
PATCH /api/cars/[id]
  Body: Partial<CarFormData> (JSON)
  → 200 { car: Car }
  → 400 { error: string }
  → 401 { error: "Unauthorized" }
  → 404 { error: "Not found" }
  → 500 { error: string }

DELETE /api/cars/[id]
  → 200 { success: true }
  → 401 { error: "Unauthorized" }
  → 404 { error: "Not found" }
  → 500 { error: string }
```

For DELETE: after `deleteCar()` succeeds, check `context.cookies.get("selected_car_id")?.value === params.id`. If true, call `context.cookies.delete("selected_car_id", { path: "/" })`.

#### 6. `src/pages/api/cars/[id]/select.ts` — set selected-car cookie

**File**: `src/pages/api/cars/[id]/select.ts` (new)

**Intent**: Sets the `selected_car_id` HttpOnly cookie to the given car ID. The API verifies the car exists and belongs to the user before setting the cookie (prevents cookie-stuffing with arbitrary UUIDs).

**Contract**:

```
POST /api/cars/[id]/select
  → 200 { success: true }
  → 401 { error: "Unauthorized" }
  → 404 { error: "Not found" }
  → 500 { error: string }
```

Cookie set: `context.cookies.set("selected_car_id", params.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 31536000 })`.

#### 7. `src/middleware.ts` — read selected-car cookie + add /cars to protected routes

**File**: `src/middleware.ts`

**Intent**: Resolve `selectedCarId` from the cookie on every request so all downstream pages read it from `context.locals`. Also protect `/cars`.

**Changes**:
- Add `"/cars"` to `PROTECTED_ROUTES`.
- Place the `selectedCarId` assignment AFTER the entire if/else block (outside both branches) — cookie reading does not depend on Supabase being configured:

```typescript
const PROTECTED_ROUTES = ["/dashboard", "/cars"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  // Must be outside the if/else — cookie is readable regardless of Supabase config.
  // App.Locals.selectedCarId is non-optional; placing this inside only one branch causes a TS error.
  context.locals.selectedCarId = context.cookies.get("selected_car_id")?.value ?? null;

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
```

### Success Criteria

#### Automated Verification

- 1.1 Lint passes: `npm run lint` exits 0
- 1.2 Build passes: `npm run build` exits 0

#### Manual Verification

- 1.3 `/api/cars` (GET) with a valid session returns `{ cars: [] }` (no cars yet)
- 1.4 `/api/cars` (POST) with valid JSON creates a car and returns `{ car: { id, brand, ... } }`
- 1.5 `/api/cars/[id]/select` (POST) sets `selected_car_id` cookie (visible in browser DevTools → Application → Cookies)
- 1.6 `/api/cars/[id]` (DELETE) clears the `selected_car_id` cookie when the deleted car was selected
- 1.7 Routing smoke test: `npm run dev` serves both `/api/cars/[id]` (PATCH) and `/api/cars/[id]/select` (POST) without a 404 — confirms `[id].ts` + `[id]/` sibling pattern works on the local Wrangler runtime
- 1.8 `PATCH /api/cars/[id]` with a partial JSON body updates a car's field and returns `{ car: { id, brand, ... } }`

---

## Phase 2: Car management UI

### Overview

Install needed shadcn components, build React `CarForm`, `DeleteCarDialog`, and `CarList`, then wire them together in a new `/cars` Astro page.

### Changes Required

#### 1. Install shadcn components

Run: `npx shadcn@latest add input label select alert-dialog`

This adds to `src/components/ui/`: `input.tsx`, `label.tsx`, `select.tsx`, `alert-dialog.tsx`.

#### 2. `src/components/cars/CarForm.tsx` — add / edit form

**File**: `src/components/cars/CarForm.tsx` (new)

**Intent**: Reusable controlled form for both adding a new car and editing an existing one. Add mode: empty form, calls `POST /api/cars`. Edit mode: pre-filled form, calls `PATCH /api/cars/[id]`. Shows inline error on API failure.

**Props**:
```typescript
interface CarFormProps {
  car?: Car;           // undefined = add mode; defined = edit mode
  onSuccess: (car: Car) => void;
  onCancel?: () => void;
}
```

**Fields** (in order): brand (required), model (required), production_year (required), registration_number (optional), engine_type (Select, required), engine_capacity (required), engine_power (required), engine_code (optional), vin_number (optional).

**Behavior**:
- Controlled state for all fields, initialized from `car` prop when in edit mode.
- Client-side required-field validation before calling API (shows inline field errors).
- `isLoading` state disables the submit button during fetch.
- On success: calls `onSuccess(createdOrUpdatedCar)`.
- On API error: shows `{ error }` from response below the submit button.
- "Cancel" button calls `onCancel()` when provided.

#### 3. `src/components/cars/DeleteCarDialog.tsx` — delete confirmation

**File**: `src/components/cars/DeleteCarDialog.tsx` (new)

**Intent**: shadcn AlertDialog asking the user to confirm deletion. Mentions that all linked maintenance entries will also be deleted (cascade warning — relevant once S-03/S-04 land, surfaced proactively).

**Props**:
```typescript
interface DeleteCarDialogProps {
  car: Car;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
}
```

AlertDialog title: `"Delete {car.brand} {car.model}?"`. Description includes the cascade warning. "Delete" button disabled when `isDeleting` is true.

#### 4. `src/components/cars/CarList.tsx` — main car management component

**File**: `src/components/cars/CarList.tsx` (new)

**Intent**: Client-side interactive car management. Receives initial data as props (server-rendered), manages all mutations locally. After any mutation it re-fetches the car list from `GET /api/cars` to stay in sync.

**Props**:
```typescript
interface CarListProps {
  initialCars: Car[];
  initialSelectedCarId: string | null;
}
```

**Internal state**: `cars`, `selectedCarId`, `editingCarId | null`, `deletingCar: Car | null`, `showAddForm: boolean`, `isLoading: boolean`, `error: string | null`.

**Rendered layout**:
- "Add car" button → toggles `showAddForm`.
- `showAddForm` → renders `<CarForm onSuccess={handleAddSuccess} onCancel={() => setShowAddForm(false)} />`.
- List of car cards, each showing brand, model, year + three action buttons:
  - "Select" — calls `POST /api/cars/[id]/select`, updates `selectedCarId` state. Disabled + visually highlighted when car is already selected.
  - "Edit" — sets `editingCarId = car.id`, renders `<CarForm car={car} onSuccess={handleEditSuccess} onCancel={() => setEditingCarId(null)} />` inline below the card.
  - "Delete" — sets `deletingCar = car`, opens `<DeleteCarDialog>`.
- Empty state when `cars.length === 0`: "No cars yet. Add your first car."

**`handleAddSuccess`**: re-fetch car list, hide form, auto-select the new car (call `POST /api/cars/[id]/select`, update `selectedCarId`).

**`handleEditSuccess`**: re-fetch car list, clear `editingCarId`.

**`handleDeleteConfirm`**: call `DELETE /api/cars/[id]`; on success re-fetch list, clear `deletingCar`; if deleted car was selected, update `selectedCarId` to `null`.

#### 5. `src/pages/cars.astro` — protected car management page

**File**: `src/pages/cars.astro` (new)

**Intent**: Protected SSR page. Fetches the user's car list server-side (initial render without flicker) and passes it to `<CarList client:load>` along with the current `selectedCarId` from locals.

**Contract**:
```astro
---
import Layout from "@/layouts/Layout.astro";
import CarList from "@/components/cars/CarList";
import { createClient } from "@/lib/supabase";
import { getCars } from "@/lib/services/cars";

const supabase = createClient(Astro.request.headers, Astro.cookies);
const cars = supabase ? await getCars(supabase) : [];
const { selectedCarId } = Astro.locals;
---
<Layout title="My Cars">
  <CarList client:load initialCars={cars} initialSelectedCarId={selectedCarId} />
</Layout>
```

### Success Criteria

#### Automated Verification

- 2.1 Lint passes: `npm run lint` exits 0
- 2.2 Build passes: `npm run build` exits 0

#### Manual Verification

- 2.3 `/cars` page loads without errors; shows "No cars yet" empty state
- 2.4 Adding a car via the form creates it and shows it in the list; newly added car is auto-selected
- 2.5 Editing a car updates the card in the list
- 2.6 Deleting a car shows the confirmation dialog; confirming removes it from the list
- 2.7 Selecting a car highlights it and sets the `selected_car_id` cookie (visible in DevTools)
- 2.8 Unauthenticated GET of `/cars` redirects to `/auth/signin`

---

## Phase 3: Dashboard integration

### Overview

Update `/dashboard` to redirect to `/cars` when no car is selected (or when the cookie is stale), and to display the selected car's details when a car is selected.

### Changes Required

#### 1. `src/pages/dashboard.astro` — selected-car display + redirect

**File**: `src/pages/dashboard.astro`

**Intent**: Dashboard becomes car-aware. If `selectedCarId` is null, redirect to `/cars`. If the cookie exists but the car is no longer in the user's list (stale cookie), also redirect to `/cars`. Otherwise display the car's brand, model, and year with a "Change car" link.

**Contract** (server-side logic in frontmatter):
```typescript
const { user, selectedCarId } = Astro.locals;

if (!selectedCarId) {
  return Astro.redirect("/cars");
}

const supabase = createClient(Astro.request.headers, Astro.cookies);
const selectedCar = supabase ? await getCarById(supabase, selectedCarId) : null;

if (!selectedCar) {
  // stale cookie — car was deleted
  return Astro.redirect("/cars");
}
```

Page content: shows `selectedCar.brand`, `selectedCar.model`, `selectedCar.production_year` prominently. Includes a "Change car" link pointing to `/cars`.

### Success Criteria

#### Automated Verification

- 3.1 Lint passes: `npm run lint` exits 0
- 3.2 Build passes: `npm run build` exits 0

#### Manual Verification

- 3.3 Authenticated user with no cars: visiting `/dashboard` redirects to `/cars`
- 3.4 Authenticated user with a selected car: `/dashboard` shows the car's brand, model, and year
- 3.5 Stale cookie (car deleted externally): `/dashboard` redirects to `/cars`

---

## Testing Strategy

### Phase 1

1. Start dev server: `npm run dev`
2. Sign in as a test user
3. In browser: `fetch("/api/cars", { method: "GET", headers: { "Content-Type": "application/json" } })` → expect `{ cars: [] }`
4. `fetch("/api/cars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Renault", model: "Clio II", production_year: "2001", engine_type: "gas", engine_capacity: "1.2L", engine_power: "75hp" }) })` → expect `{ car: { id: "...", brand: "Renault", ... } }`
5. Copy the car ID. `fetch("/api/cars/<id>/select", { method: "POST" })` → expect `{ success: true }` and `selected_car_id` cookie appears in DevTools
6. `fetch("/api/cars/<id>", { method: "DELETE" })` → expect `{ success: true }` and cookie cleared

### Phase 2

1. Navigate to `/cars` — confirms page renders, empty state visible
2. Add a car via form — confirm it appears in the list
3. Click "Select" on the car — confirm visual highlight and cookie in DevTools
4. Click "Edit" — confirm form pre-fills; save → list updates
5. Click "Delete" — confirm dialog appears with cascade warning; cancel keeps car; confirm removes it

### Phase 3

1. Clear `selected_car_id` cookie manually in DevTools, navigate to `/dashboard` → confirm redirect to `/cars`
2. Select a car on `/cars`, navigate to `/dashboard` → confirm car name + year displayed

## References

- Roadmap S-01: `context/foundation/roadmap.md` — `#s-01-car-management`
- F-01 plan (schema contract): `context/changes/cars-schema/plan.md`
- PRD FR-001, FR-002, FR-009: `context/foundation/prd.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Backend foundation

#### Automated

- [x] 1.1 Lint passes: `npm run lint` exits 0 — 224789c
- [x] 1.2 Build passes: `npm run build` exits 0 — 224789c

#### Manual

- [x] 1.3 `GET /api/cars` returns `{ cars: [] }` for authenticated user with no cars — 224789c
- [x] 1.4 `POST /api/cars` creates a car and returns `{ car: { id, brand, ... } }` — 224789c
- [x] 1.5 `POST /api/cars/[id]/select` sets `selected_car_id` cookie (visible in DevTools) — 224789c
- [x] 1.6 `DELETE /api/cars/[id]` clears `selected_car_id` cookie when deleted car was selected — 224789c
- [x] 1.7 Routing smoke test: both PATCH `/api/cars/[id]` and POST `/api/cars/[id]/select` respond without 404 on `npm run dev` — 224789c
- [x] 1.8 `PATCH /api/cars/[id]` updates a car field and returns `{ car: { id, brand, ... } }` — 224789c

### Phase 2: Car management UI

#### Automated

- [x] 2.1 Lint passes: `npm run lint` exits 0 — b66a9bc
- [x] 2.2 Build passes: `npm run build` exits 0 — b66a9bc

#### Manual

- [x] 2.3 `/cars` loads without errors; shows empty state — b66a9bc
- [x] 2.4 Adding a car creates it in the list; newly added car is auto-selected — b66a9bc
- [x] 2.5 Editing a car updates the list — b66a9bc
- [x] 2.6 Deleting a car shows confirmation dialog; confirming removes it — b66a9bc
- [x] 2.7 Selecting a car highlights it and sets the cookie — b66a9bc
- [x] 2.8 Unauthenticated `/cars` redirects to `/auth/signin` — b66a9bc

### Phase 3: Dashboard integration

#### Automated

- [x] 3.1 Lint passes: `npm run lint` exits 0 — afd2b4f
- [x] 3.2 Build passes: `npm run build` exits 0 — afd2b4f

#### Manual

- [x] 3.3 Visiting `/dashboard` with no cars → redirects to `/cars` — afd2b4f
- [x] 3.4 Visiting `/dashboard` with a selected car → shows car brand, model, year — afd2b4f
- [x] 3.5 Stale cookie (car deleted) → `/dashboard` redirects to `/cars` — afd2b4f
