# Localization (English + Polish) Implementation Plan

## Overview

Add full English/Polish localization to the app using **i18next + react-i18next**, with the active locale carried in a `lang` cookie (English default), a language toggle in the sidebar, and every user-facing surface translated. Locale is resolved once in middleware into `Astro.locals.lang` and threaded into React island roots as a prop — mirroring how `selectedCarId`/`pathname` already flow. Static UI text and entry-type labels are translated; date/number formatting is left as-is (explicit decision). No URL changes, no database changes. This is roadmap slice **S-06**.

## Current State Analysis

- **No i18n exists.** `astro.config.mjs` has no `i18n` block; `package.json` has no i18n dependency. Greenfield i18n on **Astro 6 SSR + React 19 islands + Cloudflare Workers** (`output: "server"`, `@astrojs/cloudflare` adapter).
- **A proven cookie→locals→prop rail already exists.** `selected_car_id` is set by `POST /api/cars/[id]/select` (`src/pages/api/cars/[id]/select.ts:28`, options `path:"/", httpOnly:true, sameSite:"lax", maxAge:31536000`), read once in `src/middleware.ts:20` into `context.locals.selectedCarId`, typed in `src/env.d.ts`, and passed into islands as props (e.g. `MobileSidebarTrigger` gets `pathname`/`selectedCar` in `AppLayout.astro:28`). The `lang` cookie follows this rail exactly.
- **Strings live in two render worlds.** ~9 `.astro` pages + 7 `.astro` components are server-rendered; ~43 `.tsx` components are React (forms, lists, dialogs, dashboard widgets, AI chat). The translation mechanism must serve both. Nav labels are already centralized in `src/lib/nav.ts:5-7`; everything else is hardcoded English inline.
- **Only island ROOTS are separate React trees.** Most `.tsx` files are descendants of a handful of `client:`-mounted roots (e.g. `EntriesTabs` is the island; `RepairEntries`/`RepairEntryList`/`*EntryEditForm` are its children). Only the roots need i18next wiring; descendants consume the same context via `useTranslation`.
- **Layout owns `<html lang>`.** `src/layouts/Layout.astro` renders the document shell; the `lang` attribute is set there.
- **Entry-type labels are duplicated.** A `Record<string,string>` label map already appears in `src/pages/entries/[type]/[id].astro:45-50` and `EntriesTabs.tsx:10-15`; these become dictionary lookups.
- **S-05 (entry-detail-actions) is in flight.** It introduces `EntryDetailEditor.tsx` and edits the 4 `*EntryList`/`*Entries` components. The i18n sweep (Phase 2) touches the same files, so S-05 should land first (see Open Risks).

## Desired End State

A signed-in user sees a language control in the sidebar footer. Switching it sets the `lang` cookie and reloads; the entire app — sidebar, dashboard, entries (tabs, lists, forms, dialogs, edit forms), entry detail, cars, AI chat — plus the public landing and auth pages render in the chosen language (English or Polish). The choice persists across sessions and reloads. Entry-type labels are localized. Dates/numbers render exactly as they do today. No hydration warnings appear in the console in either language. First-time visitors with no cookie see English.

Verify: toggle to Polish → every surface is Polish and stays Polish across navigation and a fresh session; toggle back to English → English; load a page directly while the cookie is Polish → server-rendered Polish with no client hydration flicker/mismatch; clear the cookie → English.

### Key Discoveries:

- Cookie→locals→prop rail to mirror: `src/pages/api/cars/[id]/select.ts:28`, `src/middleware.ts:20`, `src/env.d.ts`, `AppLayout.astro:28`.
- Server singleton mutation is unsafe under Workers concurrency — use `getFixedT(lang)` or per-request `createInstance()`, never `i18next.changeLanguage()` on a shared instance during SSR.
- Island hydration parity: each island root must render in the same locale on server and client, so the root takes a `lang` prop and initializes i18next to it before first render (resources bundled, synchronous).
- Only island roots (search `client:` directives in `.astro`) need the provider; descendants use `useTranslation`.
- Entry-type label maps already exist to replace: `[type]/[id].astro:45-50`, `EntriesTabs.tsx:10-15`.

## What We're NOT Doing

- No URL-prefixed locales (`/pl/…`) — routing is unchanged; locale rides a cookie.
- No date/number reformatting — `toLocaleDateString()` calls stay as-is (explicit decision); we are not threading locale into `Intl`.
- No translation of server-side error messages — zod validation messages (7 API routes) and Supabase auth errors stay English in v1.
- No database or migration changes; no user-profile storage of locale (cookie only).
- No third language and no per-string admin/editing UI.
- No `astro-i18next` community integration — plain `i18next` + `react-i18next` to avoid Astro-version coupling.
- No public-page language switcher — the toggle lives only in the sidebar (post-login); public pages render in the cookie/default locale.

## Implementation Approach

Vertical-first, then breadth. Phase 1 builds the entire i18n machine and proves it end-to-end on one surface (the sidebar): dependencies, dictionaries, middleware locale resolution, a concurrency-safe server `t` and a hydration-safe client init, `<html lang>`, the cookie-set endpoint, and the visible toggle. Phases 2–3 are mechanical string-extraction sweeps that consume the now-stable machine — Phase 2 the protected app, Phase 3 the public pages. Translation keys are organized by surface/namespace so each sweep adds keys without touching the foundation.

## Critical Implementation Details

- **Server concurrency (load-bearing).** On Cloudflare Workers, many requests share one module instance. Never call `i18next.changeLanguage()` / mutate a shared instance to render a request's language — concurrent requests would race. For `.astro` frontmatter, derive a fixed translator with `getFixedT(Astro.locals.lang, ns)` (or build a per-request instance via `createInstance().init(...)`). This is the single most important correctness constraint in the plan.
- **Island hydration parity.** When Astro SSRs a React island it runs React server rendering; the client then hydrates. Both must use the same locale or React throws a hydration mismatch and re-renders. Pass `lang` from `Astro.locals.lang` as a prop to every island root, and initialize the client/SSR i18next instance with `lng: lang` and statically-bundled resources so the very first render is already correct. Do not read the locale asynchronously after mount.
- **Resources are bundled, not fetched.** Import the `en`/`pl` dictionaries as modules (no `i18next-http-backend`); Workers SSR needs them inline and synchronous.
- **Toggle is a full navigation, not a client mutation.** The sidebar toggle is a no-JS `<form method="POST">` (like Sign out, `AppSidebar.astro:58`) hitting `POST /api/lang/[locale]`, which sets the cookie and redirects back. A full reload sidesteps any client re-init/hydration timing issue: the next render is server-authoritative in the new locale.

## Phase 1: i18n foundation + sidebar toggle

### Overview

Stand up the full i18n machine and prove it on the sidebar: switch → cookie → reload → entire sidebar (and `<html lang>`) renders in the chosen language, SSR and island alike, with no hydration warnings.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the i18n runtime.

**Contract**: Add `i18next` and `react-i18next` to dependencies. Installed via the project's package manager; lockfile updated.

#### 2. Translation dictionaries + shared config

**File**: `src/i18n/` (new): `locales/en.json`, `locales/pl.json`, `config.ts`, `server.ts`, `client.ts`

**Intent**: One place that defines locales, default, namespaces, the bundled resources, and the two init paths (server-fixed vs client-singleton).

**Contract**:
- `config.ts` — exports `LOCALES = ["en","pl"] as const`, `DEFAULT_LOCALE = "en"`, a `Locale` type, the namespace list, and the imported resources object `{ en: {...}, pl: {...} }`.
- `server.ts` — exports a `getT(locale)` returning a fixed-language translator (`i18next.getFixedT(locale, ns)` off an instance initialized once with all resources, or a per-request `createInstance`). MUST NOT mutate global language per request.
- `client.ts` — exports an `initClientI18n(locale)` that configures the `react-i18next` singleton (`use(initReactI18next).init({ lng: locale, resources, fallbackLng: "en" })`) idempotently, for use by island roots.
- `en.json`/`pl.json` — keyed by namespace; Phase 1 only needs the `common`/`nav`/`sidebar` keys (nav labels, "Select a car", "Sign out", toggle labels). Later phases append.

#### 3. Locale resolution in middleware + type

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Resolve the request's locale once and expose it on `locals`, exactly like `selectedCarId`.

**Contract**: In `middleware.ts`, after the `selectedCarId` line, read `context.cookies.get("lang")?.value`, validate against `LOCALES`, default to `DEFAULT_LOCALE`, assign to `context.locals.lang`. In `env.d.ts`, add `lang: import("@/i18n/config").Locale` to `App.Locals` (non-optional, mirroring `selectedCarId`).

#### 4. Cookie-set endpoint

**File**: `src/pages/api/lang/[locale].ts` (new)

**Intent**: Persist the chosen locale and return the user where they were.

**Contract**: `POST` handler mirroring `cars/[id]/select.ts`. Validate `params.locale` ∈ `LOCALES` (else 404). Set cookie `lang` with the same options as `selected_car_id` (`path:"/", httpOnly:true, sameSite:"lax", maxAge:31536000`). Redirect to the `Referer` header (fallback `/dashboard`). No auth requirement — locale is not sensitive (public pages may set it too later, though the toggle is sidebar-only now).

#### 5. `<html lang>` from locale

**File**: `src/layouts/Layout.astro`

**Intent**: Set the document language for a11y/SEO correctness.

**Contract**: Set the root `<html lang>` attribute to `Astro.locals.lang`.

#### 6. Sidebar language toggle + translated sidebar

**File**: `src/components/AppSidebar.astro`, `src/lib/nav.ts`, `src/components/MobileSidebarTrigger.tsx`

**Intent**: Add the visible control and translate the sidebar — the Phase-1 proof surface.

**Contract**:
- `AppSidebar.astro` — derive `const t = getT(Astro.locals.lang)`; replace hardcoded "Select a car"/"Sign out" and `userEmail` area with `t(...)` calls. Add a language toggle in the footer: a no-JS `<form method="POST" action="/api/lang/pl|en">` (two small buttons or a select-style control) styled like the Sign out control, highlighting the active locale.
- `src/lib/nav.ts` — nav labels become translation keys (e.g. `labelKey: "nav.dashboard"`) resolved at render with `t`, OR keep `NAV_ITEMS` hrefs and map to keys in the sidebar. Choose the minimal change that keeps `MobileSidebarTrigger` working.
- `MobileSidebarTrigger.tsx` — this is an island root: accept a `lang` prop (passed from `AppLayout.astro`), call `initClientI18n(lang)`, and translate its rendered nav/labels + include the same toggle. `AppLayout.astro` passes `lang={Astro.locals.lang}` to it.

### Success Criteria:

#### Automated Verification:

- Dependencies install and lockfile is consistent: `npm install`
- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- The sidebar shows a language toggle highlighting the current locale.
- Switching to Polish sets the cookie, reloads, and renders the sidebar (desktop + mobile drawer) in Polish; switching back renders English.
- `<html lang>` reflects the active locale (inspect DOM).
- The choice persists across a full browser restart (cookie 1-year maxAge).
- No React hydration warnings in the console in either locale, on desktop and mobile.
- A first visit with no `lang` cookie renders English.

**Implementation Note**: After Phase 1 automated checks pass, pause for manual confirmation. The hydration-parity and concurrency behavior MUST be verified here before the breadth sweeps build on this foundation.

---

## Phase 2: Protected app surfaces

### Overview

Translate every string across the protected app, reusing the Phase-1 machine. Add namespaces/keys per surface; wire each React island root with `lang` + `initClientI18n`; descendants use `useTranslation`.

### Changes Required:

#### 1. Dashboard

**File**: `src/pages/dashboard.astro` and its widgets (`LastEntryCard` and deadline tiles components)

**Intent**: Translate dashboard chrome, tile/section headings, and the last-entry widget labels.

**Contract**: `.astro` uses `getT(Astro.locals.lang)`; any React widget that is an island root takes `lang` and calls `initClientI18n`. Add `dashboard` namespace keys to `en/pl`.

#### 2. Entries surfaces

**File**: `src/pages/entries.astro`, `src/components/entries/EntriesTabs.tsx`, the 4 `*Entries.tsx`, 4 `*EntryList.tsx`, 4 `*EntryForm.tsx`, 4 `*EntryEditForm.tsx`, `EntryDetail.astro`, `EntryDetailEditor.tsx`, `src/pages/entries/[type]/[id].astro`

**Intent**: Translate tabs, list/empty states, create + edit form labels/placeholders/validation-display text, dialog copy, and the detail view; centralize entry-type labels.

**Contract**: `EntriesTabs` is the island root — it takes `lang`, calls `initClientI18n`, and its descendants (`*Entries`/`*EntryList`/`*EntryForm`/`*EntryEditForm`) use `useTranslation`. `EntryDetailEditor` (island root from S-05) takes `lang` + inits. `EntryDetail.astro` and `[type]/[id].astro` use `getT`. Replace the duplicated entry-type label maps (`[type]/[id].astro:45-50`, `EntriesTabs.tsx:10-15`) with dictionary lookups under an `entries`/`entryTypes` namespace. Client-side validation strings (e.g. "Description is required", `RepairEntryEditForm.tsx:32`) become keys. (Server zod messages remain English — out of scope.)

#### 3. Cars surface

**File**: `src/pages/cars.astro`, `src/components/cars/CarList.tsx` (+ car form/dialog components)

**Intent**: Translate the car list, selection control, create/edit/delete dialogs.

**Contract**: `CarList` is an island root — `lang` prop + `initClientI18n`; `.astro` uses `getT`. Add `cars` namespace keys.

#### 4. AI chat surface

**File**: `src/pages/ai-chat.astro` and the AI chat island component(s)

**Intent**: Translate static chrome of the AI chat page (input placeholder, headings, buttons). Streaming message content from the model is data, not chrome — not translated.

**Contract**: Chat island root takes `lang` + inits; `.astro` uses `getT`. Add `aiChat` namespace keys.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With Polish selected, every protected page (dashboard, entries list, all 4 tabs, create + edit forms, delete dialogs, entry detail, cars, AI chat chrome) renders in Polish; switching to English renders English.
- Entry-type labels render localized in the tabs, list cards, and detail header.
- Client-side form validation messages appear in the active language.
- No hydration warnings on any island-bearing page in either locale.
- No remaining hardcoded English in the protected app (spot-check each surface).

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation before Phase 3.

---

## Phase 3: Public surfaces

### Overview

Translate the public landing and auth pages so a user whose cookie/default locale is Polish sees them in Polish.

### Changes Required:

#### 1. Landing page

**File**: `src/pages/index.astro` (and any landing components)

**Intent**: Translate hero/marketing copy and the sign-in/sign-up CTAs.

**Contract**: `.astro` uses `getT(Astro.locals.lang)`; add a `landing` namespace. No toggle here (locale comes from cookie/default).

#### 2. Auth pages

**File**: `src/pages/auth/signin.astro`, `signup.astro`, `confirm-email.astro`, and their form components

**Intent**: Translate field labels, buttons, helper text, and client-side form messages.

**Contract**: `.astro` uses `getT`; any auth form island root takes `lang` + `initClientI18n`. Add an `auth` namespace. Server-returned Supabase auth error strings remain English (out of scope).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With the `lang` cookie set to Polish, the landing page and all three auth pages render in Polish; with no cookie / English, they render English.
- Sign-in / sign-up / confirm-email flows work in both languages (client-side copy localized; server auth errors may remain English).
- No hydration warnings on auth pages with form islands.

**Implementation Note**: After Phase 3 automated checks pass, pause for manual confirmation, then run the full-app regression below.

---

## Phase 4: Localization completeness sweep

### Overview

After the breadth sweeps of Phases 2–3, a targeted pass for strings that routinely escape surface-level translation: engine-type display values in car cards, page `<title>` meta strings, `LastEntryCard.astro` widget copy, `dashboard.astro` inline strings, and a systematic grep audit to find and fix any remaining hardcoded English across all `.astro` and `.tsx` files.

### Changes Required:

#### 1. Engine-type display labels

**File**: `src/components/cars/CarList.tsx`

**Intent**: Car cards currently show `car.engine_type.toUpperCase()` (renders "GAS", "DIESEL", "ELECTRIC", "LPG"). These should be translated.

**Contract**: Inside `CarListContent` (which already has `useTranslation`), map `engine_type` values to existing `cars.form.*` keys (`cars.form.gasoline`, `cars.form.diesel`, `cars.form.electric`, `cars.form.lpg`) using a lookup object. No new translation keys needed.

#### 2. `LastEntryCard.astro` widget strings

**File**: `src/components/LastEntryCard.astro`

**Intent**: "Last entry" label, the hardcoded `entryTypeLabel` map, and the raw "Passed"/"Failed" inspection result value are all untranslated.

**Contract**: Import `getT` from `@/i18n/server`; derive `t = getT(Astro.locals.lang)`. Replace "Last entry" with `t("dashboard.lastEntry")`; replace the `entryTypeLabel` map with `t("entries.types.*")` lookups; map "Passed"/"Failed" to `t("entries.results.passed")` / `t("entries.results.failed")`.

#### 3. `dashboard.astro` inline strings

**File**: `src/pages/dashboard.astro`

**Intent**: The dashboard page contains multiple hardcoded English inline strings passed to child slots and DeadlineCard title props: "Oil Change", "Inspection", "Insurance" (DeadlineCard titles); "Change car", "Last:", "Next due:", "or at ~X km", "No oil change entries logged.", "No inspection entries logged.", "Next date not set.", "Next inspection:", "No insurance entries logged.", "Renewal:".

**Contract**: Use `getT(lang)` (imported for Phase 2); translate DeadlineCard title props using `t("dashboard.oilChange")`, `t("dashboard.inspection")`, `t("dashboard.insurance")`; translate all inline strings using existing `dashboard.*` keys. Add any missing keys to both locale files.

#### 4. Page `<title>` meta strings

**Files**: `src/pages/dashboard.astro`, `src/pages/entries.astro`, `src/pages/cars.astro`, `src/pages/ai-chat.astro`

**Intent**: The `title` prop passed to `<AppLayout>` is constructed with hardcoded English fragments (e.g. `"My Cars"`, `"AI Chat"`, `"Service history"`).

**Contract**: Use `getT` (already imported for Phase 2 in these files) to build the title string. Reuse existing nav/page-level keys (`t("cars.myCars")`, `t("nav.aiChat")`, `t("entries.serviceHistory")`, `t("nav.dashboard")`) wherever they exist; add new `meta.*` keys only if no existing key fits.

#### 5. Systematic audit: remaining hardcoded English

**Files**: All `.astro` and `.tsx` files under `src/`

**Intent**: After Phases 2–4, grep for string literals in template/JSX positions that should have been translated but weren't, then fix any found.

**Contract**: Run `grep` for quoted English string patterns in JSX text and Astro template expressions (e.g., `>"[A-Z]`, `="[A-Z]` in template positions). Review output; patch stragglers; update locale files if new keys are needed.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Car list cards show translated engine type labels (e.g. "Benzyna" / "Diesel" in Polish).
- `LastEntryCard` shows Polish copy in all fields when locale is Polish.
- Dashboard DeadlineCard titles and all inline strings are Polish when locale is Polish.
- All page `<title>` meta strings appear in the active locale.
- Spot-check every page in Polish — no visible hardcoded English strings remain anywhere.
- Final grep audit returns no untranslated template strings.

---

## Testing Strategy

### Manual Testing Steps:

1. Fresh session, no cookie → app is English; `<html lang="en">`.
2. Sidebar toggle → Polish → cookie set, reload, every protected surface Polish; navigate around — stays Polish.
3. Restart browser → still Polish (persistence).
4. Toggle back → English everywhere.
5. Directly load `/dashboard`, `/entries`, an entry detail, `/cars`, `/ai-chat` with the Polish cookie → server-rendered Polish, no console hydration warnings.
6. Public pages: with Polish cookie, load `/`, `/auth/signin`, `/auth/signup` → Polish; clear cookie → English.
7. Entry-type labels: confirm localized in tabs, cards, and detail header.
8. Regression: create/edit/delete entries (S-05 flows), car CRUD, AI chat, sign-in/out all still function in both locales.

## Performance Considerations

i18next adds a small runtime to each island root and to SSR; resources are bundled (no network fetch). Keep namespaces lean and load only needed namespaces per surface to limit island bundle growth on Workers. The cookie path adds no DB round-trip (resolved in middleware from the cookie).

## Migration Notes

None — no data or schema changes. Existing users without a `lang` cookie default to English (current behavior preserved).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06)
- Cookie→locals→prop rail: `src/pages/api/cars/[id]/select.ts:28`, `src/middleware.ts:20`, `src/env.d.ts`, `src/layouts/AppLayout.astro:28`
- Sidebar / toggle home: `src/components/AppSidebar.astro:56-66`, nav labels `src/lib/nav.ts:5-7`
- Entry-type label maps to centralize: `src/pages/entries/[type]/[id].astro:45-50`, `src/components/entries/EntriesTabs.tsx:10-15`
- In-flight dependency: S-05 `context/changes/entry-detail-actions/plan.md` (introduces `EntryDetailEditor.tsx`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: i18n foundation + sidebar toggle

#### Automated

- [x] 1.1 Dependencies install and lockfile consistent: `npm install` — ab403bd
- [x] 1.2 Type checking passes: `npm run lint` — ab403bd
- [x] 1.3 Build succeeds: `npm run build` — ab403bd

#### Manual

- [x] 1.4 Sidebar shows a language toggle highlighting the current locale
- [x] 1.5 Switching locale sets cookie, reloads, renders sidebar (desktop + mobile) in chosen language
- [x] 1.6 `<html lang>` reflects the active locale
- [x] 1.7 Choice persists across a full browser restart
- [x] 1.8 No hydration warnings in either locale (desktop + mobile)
- [x] 1.9 First visit with no cookie renders English

### Phase 2: Protected app surfaces

#### Automated

- [x] 2.1 Type checking passes: `npm run lint` — 11140a7
- [x] 2.2 Build succeeds: `npm run build` — 11140a7

#### Manual

- [x] 2.3 Every protected surface renders in the selected language (both directions) — 11140a7
- [x] 2.4 Entry-type labels render localized in tabs, cards, and detail header — 11140a7
- [x] 2.5 Client-side form validation messages appear in the active language — 11140a7
- [x] 2.6 No hydration warnings on any island-bearing page in either locale — 11140a7
- [x] 2.7 No remaining hardcoded English in the protected app (spot-check) — 11140a7

### Phase 3: Public surfaces

#### Automated

- [x] 3.1 Type checking passes: `npm run lint`
- [x] 3.2 Build succeeds: `npm run build`

#### Manual

- [x] 3.3 Landing + all 3 auth pages render in Polish with the Polish cookie, English otherwise
- [x] 3.4 Auth flows work in both languages (client copy localized)
- [x] 3.5 No hydration warnings on auth pages with form islands

### Phase 4: Localization completeness sweep

#### Automated

- [ ] 4.1 Type checking passes: `npm run lint`
- [ ] 4.2 Build succeeds: `npm run build`

#### Manual

- [ ] 4.3 Car list cards show translated engine type labels in both locales
- [ ] 4.4 LastEntryCard renders fully in the active locale (label, entry type, result)
- [ ] 4.5 Dashboard DeadlineCard titles and inline strings appear in the active locale
- [ ] 4.6 All page `<title>` meta strings appear in the active locale
- [ ] 4.7 Spot-check every page in Polish — no visible hardcoded English strings remain
- [ ] 4.8 Final grep audit returns no untranslated template strings
