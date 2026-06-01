# Repair Entry Logging Implementation Plan

## Overview

Allow a logged-in user to view and add repair entries for their selected car. Adds a new `/entries` page (linked from the Topbar) with a persistent add-entry form and a chronological entry list. This is S-03 — the first entry-logging slice; S-04 (more entry types) and S-05 (edit/delete) build on top of it.

## Current State Analysis

- `repair_entries` table is live in Supabase with columns: `id`, `car_id`, `user_id`, `conducted_at` (DATE NOT NULL), `mileage` (INTEGER nullable), `description` (TEXT NOT NULL), `cause` (TEXT nullable), `created_at`, `updated_at`. RLS enforces `user_id = auth.uid()` on all operations.
- `RepairEntry` and `RepairEntryFormData` types already exported from `src/types.ts` (F-02).
- Selected car tracked via `selected_car_id` cookie; available as `Astro.locals.selectedCarId` / `context.locals.selectedCarId` on every server request.
- No entry-related service, API routes, components, or pages exist yet.
- shadcn Textarea not installed — `src/components/ui/` has: Input, Label, Button, Select, AlertDialog.
- Auth guard pattern (established by impl-review fix): `context.locals.user` for the 401 check; `createClient` for the Supabase DB client.
- Topbar (`src/components/Topbar.astro:13`) currently links only to Dashboard.

## Desired End State

A user navigates to `/entries` via the Topbar, sees a form to add a repair entry above a list of existing entries for their selected car (sorted by `conducted_at` DESC). Submitting the form clears it and prepends the new entry to the list — no page reload required. Visiting `/entries` with no car selected redirects to `/cars`.

### Key Discoveries

- `entry_type: "repair"` is not stored in the DB — the service must inject it as `entry_type: 'repair' as const` on every returned row (`context/changes/entries-schema/plan.md`)
- RLS on `repair_entries` enforces `user_id = auth.uid()` — no extra ownership check needed in the service beyond using the authenticated Supabase client
- Selected car redirect pattern: `dashboard.astro:8-9` — `if (!selectedCarId) return Astro.redirect("/cars")`
- Service pattern: `cars.ts:4-8` — accept `SupabaseClient`, SELECT `*`, order, throw on `res.error`, cast to type
- API route auth pattern: `chat.ts:10-11` — `if (!context.locals.user) return Response.json({ error: "Unauthorized" }, { status: 401 })`
- Form component pattern: `CarForm.tsx` — `form` state object + `fieldErrors` + `apiError` + `isLoading`; `setField<K>` helper clears error on change

## What We're NOT Doing

- No edit or delete of entries — that is S-05
- No other entry types (oil change, inspection, insurance) — that is S-04
- No filtering, pagination, or search on the entries list
- No AI integration with entries — that is a S-02 addendum
- No toast library — inline error feedback, consistent with the rest of the app
- No mileage auto-fill from previous entries
- The `cause` field is optional in the UI — the roadmap risk note ("must not be optional in the UI") was a planning mistake; `cause` matches its DB column: nullable and optional

## Implementation Approach

Three-layer stack mirroring car management:

**Service** (`src/lib/services/entries.ts`): `getRepairEntries` (SELECT ordered by `conducted_at` DESC, inject `entry_type`) and `createRepairEntry` (INSERT, return new row with `entry_type`).

**API route** (`src/pages/api/entries/repair.ts`): GET (list by `car_id` query param) + POST (create with Zod-validated body). Auth via `context.locals.user`; `createClient` for DB.

**React layer**: `RepairEntryForm` owns form state and POST; `RepairEntryList` is a pure display component; `RepairEntries` orchestrates state and wires the two together.

**Astro page** (`src/pages/entries.astro`): server-fetches entries for the selected car, passes them + `carId` to the island with `client:load`.

---

## Phase 1: Service + API Routes

### Overview

Create the entries service and the `/api/entries/repair` route. After this phase the backend chain is verifiable with `curl` — GET returns entries for a car, POST creates one.

### Changes Required

#### 1. Install shadcn Textarea

**File**: `src/components/ui/textarea.tsx` (via shell — `npx shadcn@latest add textarea`)

**Intent**: Add the shadcn Textarea component so description and cause fields are styled consistently with other shadcn inputs.

**Contract**: Run `npx shadcn@latest add textarea` in the project root. The command creates `src/components/ui/textarea.tsx` automatically. No other files need to be touched.

#### 2. Repair entries service

**File**: `src/lib/services/entries.ts`

**Intent**: Encapsulate all `repair_entries` Supabase queries. Mirrors `src/lib/services/cars.ts` exactly — functions accept `SupabaseClient` as first param and throw on Supabase error.

**Contract**:
- `getRepairEntries(supabase: SupabaseClient, carId: string): Promise<RepairEntry[]>` — SELECT `*` FROM `repair_entries` WHERE `car_id = carId` ORDER BY `conducted_at` DESC. Throws on `res.error`. Maps each row: `{ ...row, entry_type: 'repair' as const }`.
- `createRepairEntry(supabase: SupabaseClient, userId: string, carId: string, data: RepairEntryFormData): Promise<RepairEntry>` — INSERT `{ user_id: userId, car_id: carId, ...data }`, SELECT single. Throws on error. Returns `{ ...row, entry_type: 'repair' as const }`.

#### 3. API route

**File**: `src/pages/api/entries/repair.ts`

**Intent**: Expose GET (list entries for a car) and POST (create a repair entry). Auth-guarded via `context.locals.user`. Zod-validates both endpoints' inputs.

**Contract**:
- Exports `GET: APIRoute` and `POST: APIRoute`.
- Both return 401 if `!context.locals.user`. Both call `createClient(context.request.headers, context.cookies)` for DB.
- **GET**: reads `car_id` from `new URL(context.request.url).searchParams.get('car_id')`. Returns 400 `{ error: 'car_id is required' }` if missing or not a valid UUID (validate with `z.string().uuid()`). Calls `getRepairEntries(supabase, carId)`. Returns `{ entries }`.
- **POST**: parses request JSON (return 400 on invalid JSON). Zod schema:
  ```ts
  z.object({
    car_id: z.string().uuid('Invalid car ID'),
    conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    mileage: z.number().int().min(0).nullable().optional(),
    description: z.string().min(1, 'Description is required'),
    cause: z.string().nullish().transform(v => v ?? null),
  })
  ```
  Calls `createRepairEntry(supabase, user.id, result.data.car_id, { conducted_at, mileage, description, cause })`. Returns `{ entry }` with status 201.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` passes with no TypeScript errors in new files

#### Manual Verification

- `curl -N -X GET "http://localhost:4321/api/entries/repair?car_id=<valid-car-uuid>" -H "Cookie: <session>"` returns `{ "entries": [] }` for a car with no entries
- `curl -N -X POST -H "Content-Type: application/json" -H "Cookie: <session>" -d '{"car_id":"<uuid>","conducted_at":"2026-06-01","description":"Replaced brake pads","cause":"Worn pads"}' http://localhost:4321/api/entries/repair` returns `{ "entry": { ... } }` with status 201
- Same POST without session cookie returns 401
- POST with `"description":""` returns 400

**Implementation Note**: After all automated and curl verifications pass, confirm before proceeding to Phase 2.

---

## Phase 2: React Components

### Overview

Build the client-side component tree: form, list, and orchestrating island. shadcn Textarea was installed in Phase 1.

### Changes Required

#### 1. RepairEntryForm component

**File**: `src/components/entries/RepairEntryForm.tsx`

**Intent**: Controlled form for adding a repair entry. Follows `CarForm.tsx` pattern exactly. POSTs to `/api/entries/repair`. Calls `onSuccess(entry)` on success — the parent island handles list update and form reset via key change.

**Contract**:
- Props: `{ carId: string; onSuccess: (entry: RepairEntry) => void }`
- Initial form state: `conducted_at` = today (`new Date().toISOString().slice(0, 10)`), `description: ''`, `cause: ''`, `mileage: null`
- State: `form` (RepairEntryFormData), `fieldErrors` (partial record keyed by form field), `apiError` (string | null), `isLoading` (boolean)
- `setField<K>` helper: updates `form[key]`, clears `fieldErrors[key]`
- Client-side validation: `description` must be non-empty
- `conducted_at` field: `<Input type="date" />`. `description` and `cause`: `<Textarea />`. `mileage`: `<Input type="number" min="0" />`; value is parsed to `parseInt` or `null` on change
- Button text: "Saving…" while `isLoading`, "Log entry" otherwise; disabled while `isLoading`
- `apiError` rendered as `<p className="text-destructive text-sm">` below the submit button

#### 2. RepairEntryList component

**File**: `src/components/entries/RepairEntryList.tsx`

**Intent**: Pure display component. Renders each entry as a card. Shows a contextual empty state when the array is empty.

**Contract**:
- Props: `{ entries: RepairEntry[] }`
- Empty state: `<p className="text-muted-foreground text-sm">No repair entries yet. Log your first one above.</p>`
- Per entry card: `conducted_at` formatted with `new Date(entry.conducted_at).toLocaleDateString()`, `description`, `cause` (only if non-null — label "Cause:"), `mileage` (only if non-null — label "Mileage:", value + " km")

#### 3. RepairEntries island

**File**: `src/components/entries/RepairEntries.tsx`

**Intent**: Orchestrating island. Owns the `entries` array state and the `formKey` counter used to reset the form after a successful submit without needing a prop-drilling reset callback.

**Contract**:
- Props: `{ initialEntries: RepairEntry[]; carId: string }`
- State: `entries` (initialized from `initialEntries`), `formKey` (number, starts at 0)
- `handleSuccess(entry: RepairEntry)`: `setEntries(prev => [entry, ...prev])`, `setFormKey(k => k + 1)`
- Renders `<RepairEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />` above `<RepairEntryList entries={entries} />`

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes with no TypeScript errors in new files

#### Manual Verification

- Components render without console errors when the page loads (verified in Phase 3)

**Implementation Note**: After automated checks pass, confirm before proceeding to Phase 3.

---

## Phase 3: Astro Page + Navigation

### Overview

Mount the island on a protected Astro page, wire up `PROTECTED_ROUTES` and the Topbar link, then run the end-to-end smoke test in `wrangler dev`.

### Changes Required

#### 1. Add /entries to PROTECTED_ROUTES

**File**: `src/middleware.ts`

**Intent**: Redirect unauthenticated visitors away from `/entries`, consistent with every other protected route.

**Contract**: Add `"/entries"` to the `PROTECTED_ROUTES` array.

#### 2. Create entries page

**File**: `src/pages/entries.astro`

**Intent**: Server-render the page with the selected car's entries pre-loaded, so the island mounts with data and avoids a client-side loading flash. Mirrors `dashboard.astro` patterns.

**Contract**:
- Frontmatter reads `Astro.locals.selectedCarId`; if null, `return Astro.redirect("/cars")`
- Creates Supabase client with `createClient(Astro.request.headers, Astro.cookies)`
- Calls `getRepairEntries(supabase, selectedCarId)` and `getCarById(supabase, selectedCarId)` (for the page heading); if `getCarById` returns null, redirect to `/cars`
- Passes `initialEntries` and `carId={selectedCarId}` to `<RepairEntries client:load />`
- Page heading: `{car.brand} {car.model} — Repair Entries`

#### 3. Add Entries nav link to Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Make the Entries page discoverable from the Topbar navigation, alongside the existing Dashboard link.

**Contract**: Inside the authenticated user `<div class="flex items-center gap-3">` (line 12), add `<a href="/entries" class="text-purple-300 transition-colors hover:text-purple-100 hover:underline">Entries</a>` after the Dashboard link (line 13).

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- Topbar shows "Entries" link for logged-in users
- Visit `/entries` logged out → redirect to `/auth/signin`
- Visit `/entries` logged in, no car selected → redirect to `/cars`
- Visit `/entries` logged in with selected car → page loads, form visible with today's date pre-filled, description and cause are multi-line text areas
- Submit form with description only (no cause, no mileage) → entry appears at top of list, form clears to defaults
- Submit form with all fields → entry appears with cause and mileage shown
- Submit with empty description → inline validation error below the description field
- Reload page → previously added entries persist (server-fetched on load)
- "Entries" Topbar link navigates to `/entries`

**Implementation Note**: This is the definition-of-done for S-03. Do not mark the change complete until the wrangler dev smoke test passes end-to-end.

---

## Testing Strategy

### Manual Testing Steps

1. Start local Supabase: `npx supabase start`
2. Start Workers dev server: `npm run dev`
3. Sign in and ensure a car is selected at `/cars`
4. Navigate to `/entries` via the Topbar link
5. Submit a repair entry with all fields; confirm it appears at top of list
6. Submit another with description only; confirm it appears without cause/mileage rows
7. Reload page — confirm both entries persist
8. Open DevTools Network — confirm POST `/api/entries/repair` returns 201 with `entry` in the response body
9. Confirm GET `/api/entries/repair?car_id=<uuid>` on page load returns the entries
10. Sign out, navigate to `/entries` directly — confirm redirect to `/auth/signin`

## Migration Notes

None — `repair_entries` table and TypeScript types are fully in place from F-02 (`context/changes/entries-schema/plan.md`). This plan is purely additive.

## References

- Prerequisite schema plan: `context/changes/entries-schema/plan.md`
- Roadmap S-03: `context/foundation/roadmap.md`
- PRD FR-003: `context/foundation/prd.md`
- Service pattern: `src/lib/services/cars.ts`
- API route pattern: `src/pages/api/cars/index.ts`
- Auth guard pattern: `src/pages/api/ai/chat.ts:10-11`
- Form component pattern: `src/components/cars/CarForm.tsx`
- Page pattern: `src/pages/dashboard.astro`
- Topbar: `src/components/Topbar.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Service + API Routes

#### Automated

- [x] 1.1 `npm run lint` passes
- [x] 1.2 `npm run build` passes with no TypeScript errors

#### Manual

- [x] 1.3 GET /api/entries/repair?car_id=<uuid> returns `{ entries: [] }` for a car with no entries
- [x] 1.4 POST /api/entries/repair returns `{ entry: { ... } }` with status 201
- [x] 1.5 Request without session returns 401
- [x] 1.6 POST with empty description returns 400

### Phase 2: React Components

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npm run build` passes with no TypeScript errors

### Phase 3: Astro Page + Navigation

#### Automated

- [ ] 3.1 `npm run build` passes with no type errors

#### Manual

- [ ] 3.2 Topbar shows "Entries" link for logged-in users
- [ ] 3.3 /entries logged out → redirect to /auth/signin
- [ ] 3.4 /entries logged in, no car selected → redirect to /cars
- [ ] 3.5 /entries with selected car → page loads, form with today's date pre-filled
- [ ] 3.6 Submit description-only → entry at top of list, form clears
- [ ] 3.7 Submit all fields → entry shows cause and mileage
- [ ] 3.8 Empty description → inline validation error
- [ ] 3.9 Reload page → entries persist (server-fetched)
- [ ] 3.10 "Entries" Topbar link navigates to /entries
