---
date: 2026-09-02T08:40:21+02:00
researcher: Aleksander
git_commit: e3aa4226ab4839bb13636fca6def18cd317f7513
branch: main
repository: CarBooklet
topic: "Light/dark theme: toggle mechanics, FOUC, token migration inventory, and a single-source-of-truth theme manager"
tags: [research, codebase, theming, tailwind-v4, design-tokens, ssr, accessibility, astro]
status: complete
last_updated: 2026-09-02
last_updated_by: Aleksander
---

# Research: Light/dark theme — toggle mechanics, token migration, and a theme manager

**Date**: 2026-09-02T08:40:21+02:00
**Researcher**: Aleksander
**Git Commit**: `e3aa4226ab4839bb13636fca6def18cd317f7513` (branch `main`, 23 commits ahead of `origin/main` — not pushed, so no GitHub permalinks in this document)
**Repository**: CarBooklet

## Research Question

From `context/changes/light-dark-mode/change.md`, three of the four open questions, plus one addition requested at research time:

1. **Theme toggle mechanics + FOUC** — where does `.dark` get set, how is the choice persisted, and how is the flash-on-SSR problem handled given `output: "server"`?
2. **Token migration inventory** — a file-by-file audit of the hardcoded-color files, mapping each to a target token.
3. **A theme manager** — _"propose a solution to use a theme manager so we do not hardcode colors everywhere but instead hold one source of truth."_
4. Prior decisions in `context/archive/**` that constrain the change.

---

## Summary

**The headline finding is that the FOUC problem is smaller than `change.md` assumed, and the migration is bigger.**

`change.md:110-113` states the theme "needs an inline pre-hydration script, not a React effect." That is only half true. The app already resolves a cookie in middleware _before any HTML is produced_ (`src/middleware.ts:38-41`) and already renders a server-computed attribute onto `<html>` (`src/layouts/Layout.astro:14`). So for a user who has expressed a preference, the server can emit `<html class="dark">` directly — **zero FOUC, zero JavaScript, and `httpOnly` preserved**. An inline script is needed for exactly one case: the user who has expressed _no_ preference and should follow `prefers-color-scheme`, which the server cannot know.

Conversely, the migration surface is **38 files and 135 lines**, not the 31 files recorded at `change.md:23-25`. The original grep misses raw hex (`Banner.astro` ×9, `bg-cosmic` ×3) and `rgba()` literals in an inline `style` attribute (`Welcome.astro:25`). Total distinct hardcoded color values: **72**.

Four findings materially change the shape of the work:

1. **The app is a dark design painted on a _light_ token set.** `:root` (`global.css:6-41`) is stock shadcn light — `--background: oklch(1 0 0)` is pure white. `@layer base` applies it to `body` (`global.css:115-117`), then every page covers it with `bg-cosmic`. So every shadcn primitive (`Input`, `Textarea`, `Select`) resolves _light_ tokens — near-black text, near-white hairlines — onto dark glass panels. **This is a live contrast defect today**, not merely migration debt. The `.dark` block at `global.css:43-67` has never executed.
2. **Three pre-existing bugs** will be picked up for free (or must be consciously deferred): `--destructive-foreground` is referenced at `EntryDetailEditor.tsx:179` and `ui/button.tsx:14` but **never defined**; `FormField.tsx:53`'s `border-white/20` is a live WCAG 1.4.11 failure (form borders need 3:1); `EntryDetail.astro:116`'s `text-blue-100/40` is already below 4.5:1.
3. **The `--color-*` alias in `@theme inline` is the silent-failure mode of the whole architecture.** A token declared in `:root` but not aliased in `@theme inline` (`global.css:69-105`) produces a class that compiles to **nothing** — no error, no warning, just an unstyled element. Same for any dynamically-built class string. This is the single most likely way to break the migration.
4. **There is zero automated safety net for this change's primary failure mode.** Playwright exists (3 specs) but `toHaveScreenshot` / `toMatchSnapshot` / `toHaveCSS` return **zero hits repo-wide**. The existing suites will stay green through a white-on-white page.

The proposed architecture — CSS tokens → cva variants → one `src/lib/theme.ts` mapper → a lint gate — is sound and mirrors patterns already in the repo. But be clear about proportions: **~70% of the literals are a rename, ~30% want a variant.** The variant layer is the interesting part and the small part.

---

## Detailed Findings

### 1. Theme toggle mechanics and FOUC

#### 1.1 Nothing sets a class today

`src/layouts/Layout.astro` is the single root layout; every page reaches it directly or via `AppLayout`.

- `Layout.astro:14` — `<html lang={Astro.locals.lang}>` carries **only** `lang`. No `class`, no `data-theme`.
- `Layout.astro:21` — `<body>` carries no class.
- `Layout.astro:15-20` — the `<head>` has four static children and nothing else. Astro injects the `global.css` stylesheet link automatically; there is no explicit tag to order against.
- **There is no `<script>` tag anywhere in `src/`** — zero hits for `<script` and zero for `is:inline`. All client JS enters through React islands. An inline script would be the first in the codebase and must be `<script is:inline>`, or Astro hoists it into a deferred external module.

The CSS machinery is already complete and simply never activated: `@custom-variant dark (&:is(.dark *))` at `global.css:4`, and the full `.dark` override block at `global.css:43-67`.

**Note the `*` in the variant.** `&:is(.dark *)` matches _descendants_ of `.dark`, not the `.dark` element itself. The class must therefore land on `<html>`, and `<html>` itself will not receive `dark:` utilities.

#### 1.2 The locale rail — the pattern to mirror

`2026-06-10-i18n-en-pl` established a **cookie → locals → prop** rail, and `2026-05-27` car-selection uses the identical shape. It is a house pattern used twice.

`src/pages/api/lang/[locale].ts:11-19`:

```ts
context.cookies.set("lang", locale, {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  maxAge: 31536000,
});
const referer = context.request.headers.get("Referer") ?? "/dashboard";
return context.redirect(referer, 302);
```

Exactly four attributes — no `Secure`, no `Domain`, no `Expires` (verified: Astro's `AstroCookies.set` applies no defaults).

`src/middleware.ts:38-41` reads and validates it against an allowlist, defaulting so the value is never `undefined`. The comment at `middleware.ts:34-36` explains why this sits outside the Supabase `if/else`: `App.Locals` fields are non-optional, so a branch-local assignment is a TS error. **The same reasoning applies verbatim to a `theme` field.**

`src/env.d.ts:1-7` types it; `src/i18n/config.ts:4-6` supplies the const-tuple + derived-union + default triple (`LOCALES` / `Locale` / `DEFAULT_LOCALE`) a theme would want to copy.

The UI control is a **plain HTML form, no fetch** — `AppSidebar.astro:63-90` and its byte-for-byte React duplicate at `MobileSidebarTrigger.tsx:88-116`. No `onClick`, no `preventDefault`. The browser POSTs, the route 302s back to `Referer`, the page re-renders server-side.

Recorded rationale, `context/archive/2026-06-10-i18n-en-pl/plan.md:50`:

> "The sidebar toggle is a no-JS `<form method="POST">` (like Sign out) hitting `POST /api/lang/[locale]`, which sets the cookie and redirects back. **A full reload sidesteps any client re-init/hydration timing issue**: the next render is server-authoritative in the new locale."

And `plan.md:48`: _"Pass `lang` from `Astro.locals.lang` as a prop to every island root… **Do not read the locale asynchronously after mount.**"_

**Why it does not flash**, structurally: the cookie is read before any HTML is produced; the SSR output already contains the correct value; islands receive it as a prop and use it in a lazy `useState` initializer (`MobileSidebarTrigger.tsx:133`), so the client's first render matches the server's exactly; and the switch is a full navigation with no intermediate state.

#### 1.3 The one place theme must diverge from the locale rail

`httpOnly: true` is load-bearing. An `HttpOnly` cookie is invisible to `document.cookie`, so **an inline pre-hydration script cannot read it**, and neither can an island. The locale flow gets away with this because the server is the only reader.

Theme differs from locale in one way that matters: language affects only _text nodes_, which appear no earlier than the server sends them. Theme affects the _paint of the whole document_, including the interval before any island exists.

**But the server can still emit the class.** The value is on `Astro.locals` before the head renders, so `<html class={theme}>` at `Layout.astro:14` is server-authoritative. The three-state shape that follows:

| Cookie value | Server emits           | Inline script                                                      |
| ------------ | ---------------------- | ------------------------------------------------------------------ |
| `dark`       | `<html class="dark">`  | no-op                                                              |
| `light`      | `<html class="light">` | no-op                                                              |
| _unset_      | `<html>` (no class)    | reads `matchMedia("(prefers-color-scheme: dark)")`, adds the class |

The script never reads the cookie, so `httpOnly` survives. It runs only for users who have not chosen — and for those users there is no server-side answer to flash _from_.

**Constraint that complicates the "unset" branch:** because `@custom-variant dark` keys on the literal `.dark` class, handling system-dark purely with a `@media (prefers-color-scheme: dark)` block that redefines tokens would leave shadcn's existing `dark:` utilities stranded (`ui/button.tsx:8,14,16,18`; `ui/input.tsx:11,13`; `ui/textarea.tsx:10`; `ui/select.tsx:34`). Either the variant definition is extended to cover the media query, or the class must always be present — which is what the inline script guarantees.

#### 1.4 SSR constraints

**Streaming is on and not configurable here.** Astro's `App` defaults to `streaming = true`; the Cloudflare adapter calls `createApp()` without overriding it, and on Workers this takes the `renderToReadableStream` path.

Two consequences:

- The `<head>` is flushed **before** the `<body>` finishes rendering. An inline head script therefore executes very early (good for FOUC) — but any class it writes goes onto an `<html>` element whose attributes were **already serialized**. The server-rendered attribute is fixed at the moment `Layout.astro:14` is emitted; only script can change it afterward.
- `cookies.set()` is safe **only** in middleware, an API route, or top-level page frontmatter. Astro warns explicitly when called later.

**No HTML transform hooks**: no `HTMLRewriter` in the adapter path, no view transitions (`ClientRouter` / `ViewTransitions` → zero hits), no `experimental` flags in `astro.config.mjs`.

**Adapter posture**: `middlewareMode: "classic"` — middleware runs inside the same Worker as the render. Cookies set there are appended after render resolves. No adapter-level cookie restrictions.

**Middleware coverage**: `src/middleware.ts` is the only middleware, with no matcher — it runs for every page and endpoint route. It does **not** run for static assets (`wrangler.jsonc:8-12` binds `./dist`, no `run_worker_first`). `grep prerender src` → zero hits, so no page opts out of SSR. Locale resolution at `:38-41` happens _before_ the `PROTECTED_ROUTES` redirect check at `:43-47`, so `locals` is populated even on requests that never render — the same ordering a theme needs.

#### 1.5 `prefers-color-scheme` today: nothing

| Pattern                           | Hits in code                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `prefers-color-scheme`            | **0** (only prose in `change.md:30,115`)                                                                        |
| `color-scheme` CSS property       | **0** — so native form controls, scrollbars, and the pre-paint canvas will not follow the theme                 |
| `matchMedia`                      | 1 — `src/hooks/use-mobile.ts:11`, the 768px breakpoint. Unrelated to color.                                     |
| `localStorage` / `sessionStorage` | **0**                                                                                                           |
| `document.cookie`                 | 1 — `src/components/ui/sidebar.tsx:76` (`sidebar_state`). **Dead code**; `SidebarProvider` is imported nowhere. |

Note that `localStorage` has never been considered _or_ rejected for a preference in this project — but it was explicitly rejected for tab persistence in `2026-06-02-additional-entry-types/plan.md:36`.

#### 1.6 How an island would read the theme

There is **no app-level React context** and no client fetch of server state. Astro islands are separate React roots, so a shared provider is impossible without wrapping a page in one island — which `CLAUDE.md` forbids. The eight islands each construct their own `I18nextProvider` (`MobileSidebarTrigger.tsx:132-139` and six siblings); `src/i18n/client.ts:8-19` documents why a fresh instance per call is required (a module-level singleton would race across concurrent Workers requests).

Three shapes are available, each with a concrete blocker:

| Shape                                | Blocker                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prop from `Astro.locals`             | Works, but must be threaded through `AppLayout.astro:28-34` and six `client:load` call sites — and **does not exist on the four `Layout.astro`-only pages** (`index`, `auth/signin`, `auth/signup`, `auth/confirm-email`), which have no sidebar and therefore no switcher |
| `document.cookie`                    | Blocked by `httpOnly: true` if the theme cookie copies the `lang` shape                                                                                                                                                                                                    |
| `document.documentElement.classList` | Works only if something set it — i.e. depends on §1.1/§1.3                                                                                                                                                                                                                 |

`src/hooks/use-mobile.ts:5-22` is the closest existing analogue to a theme hook: lazy `useState` guarded by `typeof window !== "undefined"`, then a `matchMedia` listener in `useEffect`.

---

### 2. Token migration inventory

**38 files, 135 lines, 72 distinct hardcoded color values** (57 distinct Tailwind utility strings, 12 raw hex, 3 `rgba()`).

**The good news — concentration.** Ten utilities account for **145 of ~180 total occurrences**:

`text-white` (45) · `border-white/10` (24) · `text-blue-100/60` (18) · `bg-white/10` (11) · `bg-white/5` (9) · `text-blue-100/70` (8) · `text-blue-100/50` (8) · `from-blue-200` (8) · `to-purple-200` (7) · `hover:bg-white/10` (7)

So a good mapping for six token targets — `--card`, `--card-foreground`, `--border`, `--muted-foreground`, `--foreground`, `--accent` — covers the bulk mechanically.

#### Bucket counts

| Bucket                                      |  Files |   Lines |
| ------------------------------------------- | -----: | ------: |
| **A** — mechanical find/replace             |     14 |      41 |
| **B** — needs a small decision              |     14 |      61 |
| **C** — genuinely hard                      |      7 |      30 |
| _Unbucketed (scrims — recommend no change)_ |      3 |       3 |
| **Total**                                   | **38** | **135** |

#### Bucket A — mechanical (14 files, 41 lines)

`entries/EntryDetail.astro` (22 lines, but only **two** distinct strings: `text-blue-100/60` on every label → `--muted-foreground`, `text-white` on every value → `--card-foreground`) · `entries/{Repair,OilChange,Insurance}EntryList.tsx:21` · `entries/{Repair,OilChange,Inspection,Insurance}Entries.tsx:25,29` · `entries/EntryDetailEditor.tsx:131` · `auth/PasswordToggle.tsx:13` · `auth/SignUpForm.tsx:75` · `AppSidebar.astro:22` · `MobileSidebarTrigger.tsx:39,49` · `ui/LibBadge.astro:10,12` _(file has no importers — migrate or delete)_.

#### Bucket B — needs a decision (14 files, 61 lines)

The six **glass-panel pages** share one recipe: `rounded-2xl border border-white/10 bg-white/10 p-8 text-white backdrop-blur-xl` with a `from-blue-200 to-purple-200 bg-clip-text text-transparent` heading — `dashboard.astro:46`, `entries.astro:57`, `ai-chat.astro:40`, `entries/[type]/[id].astro:66,77`, `auth/signin.astro:13`, `auth/signup.astro:13`, `auth/confirm-email.astro:27`, plus `LastEntryCard.astro:39`.

**The one decision that defines the migration**: does `bg-white/10 backdrop-blur-xl` become an _opaque_ `--card` (and `backdrop-blur-xl` is deleted), or stay translucent? Glass exists only to read against the `bg-cosmic` gradient. **On a white `--background`, `bg-white/10` is invisible.** One decision, seven-plus sites.

Other B items:

- **A three-level text hierarchy collapses to two tokens.** `dashboard.astro` uses `text-white` (value) > `text-blue-100/70` (label) > `text-blue-100/50` (tertiary); the token set offers only `--card-foreground` and `--muted-foreground`. Accept the flattening or add a third token.
- `EntriesTabs.tsx:57` — the active-tab underline `border-b-2 border-purple-400`. `--primary` is near-black in light mode and would read as a plain rule, not an accent. **This is exactly the case `--accent-ink` exists for.**
- `auth/SubmitButton.tsx:18` — `bg-purple-600 text-white hover:bg-purple-500` is a `className` that _fights_ the `Button` variant underneath it. The clean fix is deleting the override and letting `variant="default"` apply `bg-primary` — a behavioral change, not a rename. `:22`'s spinner needs contrast against the _button fill_, so `--primary-foreground/30` + `--primary-foreground`.
- `auth/ServerError.tsx:11` — `border-red-500/30 bg-red-900/30 text-red-300`: a surface + border + text **triple**, all dark-only choices.
- `ai/StreamingText.tsx:11` — `text-white/90`; the `/90` is a deliberate softening with no token equivalent.
- `AppLayout.astro:27,35` — `border-white/10` → `--border` (A) and `text-white/80` (B).
- `ui/button.tsx:14` — requires **adding** `--destructive-foreground` first.

#### Bucket C — genuinely hard (7 files, 30 lines)

**`DeadlineCard.astro:11-31`** — the domain traffic light, verbatim:

```ts
const borderBg: Record<DeadlineStatus, string> = {
  red: "border-red-400/50 bg-red-500/10",
  yellow: "border-amber-400/50 bg-amber-500/10",
  green: "border-green-400/50 bg-green-500/10",
  no_data: "border-white/10 bg-white/5",
  no_next_date: "border-white/10 bg-white/5",
};
const dotColor: Record<DeadlineStatus, string> = {
  red: "bg-red-400",
  yellow: "bg-amber-400",
  green: "bg-green-400",
  no_data: "bg-white/30",
  no_next_date: "bg-white/30",
};
```

Two independent problems: (a) each `--status-*` needs **two** usable values — a solid dot fill _and_ a ~10% surface wash — that work on both grounds; amber at 10% alpha is nearly invisible on white. (b) `no_data` shares `bg-white/5` with real cards, so "neutral" and "card surface" are currently the same value; whether `no_data` becomes `--muted` (recessed) or `--card` (equal) is a design call.

The status is genuine domain data — `src/lib/services/entries.ts:306-315` computes it from day thresholds and `src/types.ts:103` types it as `"no_data" | "no_next_date" | "red" | "yellow" | "green"`. **The database speaks in color names.**

**`Welcome.astro:7,10,14,18,25,33,37,43,49`** — three decorative "cosmic orbs" (`bg-purple-500/20 blur-[120px]`, `bg-blue-500/15`, `bg-indigo-400/10`), a star field built from three `rgba(255,255,255,…)` radial gradients in an inline `style` at `:25`, and a tri-stop gradient headline at `:33`. All are light-emitting shapes on a black ground, dark-only by construction. **There is no token for "decoration."**

**`Banner.astro:28-40`** — nine raw hex values in a scoped `<style>` block; the only plain-CSS component in the app, and the app's only light surface. Three problems: there is **no `--status-info` token** (its blue variant), each variant needs a surface/text/border triple, and no utility-focused sweep or grep rule will ever touch it.

**`auth/FormField.tsx:6,37,41,53,59`** — a hand-rolled reimplementation of `ui/input.tsx` (which is already fully tokenized). `:53`'s `border-white/20` is a live 3:1 failure. It also uses `focus:ring-*` (v3 idiom) where the shadcn primitives use `focus-visible:ring-*`. The real question is whether to migrate the classes or **delete the bespoke styling and adopt `ui/input.tsx`** — more work, but it fixes the contrast bug for free.

**`ai/ChatDemo.tsx:73,85,86`** — the same hand-rolled-control problem against `ui/textarea.tsx`.

**`entries/InspectionEntryList.tsx:34`** — `entry.result === "Passed" ? "text-green-400" : "text-red-400"`. A **second, different domain meaning** (pass/fail) overloading the same green/red tokens as deadline urgency. Reusing them is defensible but is a deliberate decision — and as _text_ it needs a ≥4.5:1 variant, which the dot-fill value will not satisfy.

**`global.css:107-109` + its 5 consumers** — `bg-cosmic` is a three-stop gradient, not a flat color. Consumers: `Welcome.astro:7`, `AppLayout.astro:18` (the whole authenticated shell), `auth/signin.astro:12`, `auth/signup.astro:12`, `auth/confirm-email.astro:25`.

#### Leave alone (3 files)

`ui/alert-dialog.tsx:24`, `ui/dialog.tsx:29`, `ui/sheet.tsx:28` — `bg-black/50` modal scrims. **Correct as-is in both themes**; a scrim should stay black-tinted. Mapping to `--foreground/50` would invert it in dark mode and break the modals. Also shadcn-owned, so policing them creates permanent merge friction.

#### The sidebar, and a free win

The "black in both modes" promise rests on exactly three things: the eight `--sidebar-*` vars declared **only** in `:root` (`global.css:33-40`) and deliberately absent from `.dark`; their re-export through `@theme inline` (`global.css:97-104`); and consumers that reference only those vars.

**`ui/sidebar.tsx` has zero hardcoded colors — and zero importers.** 682 lines of dead shadcn scaffolding. Its `bg-background` at `:295,309` is the only thing that would break the black-in-both-modes promise, and only if adopted.

`AppSidebar.astro` and `MobileSidebarTrigger.tsx` write `bg-[var(--sidebar)]` / `text-[var(--sidebar-foreground)]/50` at **25 sites** even though `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, and `border-sidebar-border` **already exist**. These compile to byte-identical CSS. **Zero visual diff, zero CSS change** — the cheapest possible demonstration that the token layer works, and the natural first phase.

Note `--sidebar-primary: oklch(0.78 0.1 280)` is a **purple** active indicator. Swapping it for yellow is a token edit, not a sweep.

---

### 3. Proposed theme manager (single source of truth)

#### 3.1 The `--color-*` rule — the crux

Tailwind v4 generates utilities from _namespaced_ theme variables. `--color-<name>` produces `bg-<name>`, `text-<name>`, `border-<name>`, `ring-<name>`, `outline-<name>`, `fill-`, `stroke-`, `from-/via-/to-`, `divide-`, `accent-`, `caret-`, `shadow-`, `decoration-`, `placeholder-` — all of them, free. Everything after `--color-` becomes the suffix verbatim, dashes included.

**`--status-warn` alone generates nothing.** It becomes a utility only when a second declaration inside `@theme` aliases it as `--color-status-warn`.

**Why `inline` is load-bearing** (compiled against the installed tailwindcss 4.2.4, not quoted from docs). With `@theme inline`:

```css
.bg-status-warn {
  background-color: var(--status-warn);
}
.bg-status-warn\/10 {
  background-color: color-mix(in oklab, var(--status-warn) 10%, transparent);
}
```

Without `inline`, the same token compiles to `:root { --color-x: var(--status-warn) }` — resolved **at `:root`, once**, freezing the light value so a `.dark` override never reaches it. `inline` substitutes the declared value into the utility so resolution happens at the element.

**This is why `global.css:69-105` must stay `inline`, and why every new token needs the two-step shape**: raw value in `:root`/`.dark`, alias in `@theme inline`.

Two verified behaviors worth banking on:

- **Opacity modifiers work on custom tokens** — so `bg-red-500/10` has a direct one-for-one replacement in `bg-status-bad/10`.
- **`tailwind-merge` 3.5.0 handles custom tokens with no config.** Tested: `twMerge("bg-status-warn bg-status-bad")` → `bg-status-bad`; `twMerge("bg-[var(--sidebar)] bg-status-warn")` → `bg-status-warn`. **No `extendTailwindMerge` wrapper needed** — `cn()` stays a 3-line file.

#### 3.2 What gets added to `global.css`

```css
:root {
  --accent-ink: oklch(0.556 0.11 88.7);
  --status-ok: oklch(0.6 0.15 150);
  --status-warn: oklch(0.658 0.16 55);
  --status-bad: oklch(0.6 0.21 25);
  --status-idle: var(--muted-foreground); /* no_data / no_next_date */
}
.dark {
  --accent-ink: oklch(0.867 0.165 88.7);
  --status-ok: oklch(0.72 0.16 155);
  --status-warn: oklch(0.76 0.16 58);
  --status-bad: oklch(0.7 0.19 25);
}
@theme inline {
  --color-accent-ink: var(--accent-ink);
  --color-status-ok: var(--status-ok);
  --color-status-warn: var(--status-warn);
  --color-status-bad: var(--status-bad);
  --color-status-idle: var(--status-idle);
}
```

`--status-idle` needs no `.dark` entry — it aliases `--muted-foreground`, which already has one at `global.css:55`.

#### 3.3 The variant layer (cva) — confirmed viable in `.astro`

cva is a pure function returning a `string`, with no React dependency; Astro frontmatter is TypeScript, so it runs identically. **The repo already writes the hand-rolled equivalent**: `DeadlineCard.astro:11-25`'s two `Record<DeadlineStatus, string>` maps _are_ a cva `variants` block written longhand.

Two Astro-specific caveats:

1. `class:list` accepts arrays/objects natively, so `cn()` is optional in `.astro` — but keep `cn()` when a component takes a `class` prop that must _override_ a variant, since `class:list` concatenates while `twMerge` resolves.
2. **Class strings must be statically greppable.** `bg-status-warn` written out is found by Tailwind's scanner; `` `bg-status-${tone}` `` is **not**, and generates no CSS.

`DeadlineCard.astro` after the rewrite loses **12 literal color classes plus a `text-white`**:

```astro
---
import { statusSurface, statusDot, toneForDeadline } from "@/lib/theme";
const { title, status } = Astro.props;
const tone = toneForDeadline(status);
---

<div class:list={statusSurface({ tone })}>
  <div class="mb-3 flex items-center gap-2">
    <span class:list={statusDot({ tone })}></span>
    <h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
  </div>
  <slot />
</div>
```

The dropped `text-white` on the wrapper becomes inherited `text-foreground` from `@layer base` (`global.css:116`) — **which is what makes light mode possible at all.**

Two other recipes earn a variant:

- **The glass panel** — 7 sites, one recipe. Since `change.md` deletes the glass effect, having it in one place turns a seven-file edit into a one-line edit. Highest-value variant in the codebase.
- **The entry list row** — byte-identical at `{Inspection,Insurance,OilChange,Repair}EntryList.tsx:21`. 4 sites, one recipe.

#### 3.4 `src/lib/theme.ts` — the domain→token module

The precedent is real: `src/lib/nav.ts` is 8 lines — a `NAV_ITEMS` const, `as const`, with a header comment naming its cross-file invariant (`PROTECTED_ROUTES in src/middleware.ts must stay in sync`), consumed by both sidebar components. Mirror its style; keep it a **sibling, not an extension** (different concern, different consumers).

```ts
// Single source of truth for domain → color-token mapping.
// Cross-ref: every token named here must exist as `--color-*` in
// src/styles/global.css's `@theme inline` block, or the class is silently dropped.
// Class strings MUST be written out in full — `bg-status-${tone}` generates no CSS.

export type Tone = "ok" | "warn" | "bad" | "idle";

/** Deadline traffic light. `red|yellow|green` are DB-level names, deliberately
 *  translated here so the palette can move without touching src/types.ts. */
export const toneForDeadline = (s: DeadlineStatus): Tone =>
  s === "red" ? "bad" : s === "yellow" ? "warn" : s === "green" ? "ok" : "idle";

/** Inspection pass/fail — currently inline at InspectionEntryList.tsx:34. */
export const toneForResult = (r: string | null): Tone => (r === "Passed" ? "ok" : r === "Failed" ? "bad" : "idle");

export const statusSurface = cva("rounded-xl border p-5", {
  variants: {
    tone: {
      ok: "border-status-ok/50 bg-status-ok/10",
      warn: "border-status-warn/50 bg-status-warn/10",
      bad: "border-status-bad/50 bg-status-bad/10",
      idle: "border-border bg-muted/40",
    },
  },
  defaultVariants: { tone: "idle" },
});

export const surface = cva("border transition-colors", {
  variants: {
    level: {
      panel: "rounded-2xl border-border bg-card p-6",
      row: "rounded-lg border-border bg-card p-4 hover:bg-accent",
    },
  },
});
```

Why it earns its keep:

- **Testable with no new infrastructure.** `vitest.config.ts:34-48` already runs a `unit` project over `src/test/**/*.test.ts` with the `@` alias wired. A test asserting `toneForDeadline("yellow") === "warn"` catches the day someone adds a sixth `DeadlineStatus`.
- **Greppable.** "What color is a warn state?" is one `grep` in one file, not 38.
- **Decouples DB vocabulary from palette vocabulary.** Because `DeadlineStatus` literally is `"red" | "yellow" | "green"`, mapping `red → bad` in one function is what lets the warn state move off Renault yellow — **the exact collision `change.md:37-42` flags** — with no migration and no `src/types.ts` edit.

#### 3.5 Enforcement

`.husky/pre-commit` is `set -e` plus `npx lint-staged` → `npm run lint` → `npm run typecheck` → `npm test`. CI runs lint + build.

**Option A — a grep gate (recommended to start).** A `lint:colors` script matching palette literals in `*.astro` / `*.tsx`, added to `.husky/pre-commit` and CI. **~50 ms, zero new dependencies**, and it reuses the exact grep already recorded at `change.md:23-25` so the numbers stay comparable across the migration.

`--exclude-dir=ui` matters: `src/components/ui/` holds four _legitimate_ literals (`button.tsx:14`'s contrast-locked `text-white`, and the three `bg-black/50` scrims). They are shadcn-owned and get overwritten by `npx shadcn add`; policing them is permanent merge friction for no benefit. The exception is `ui/LibBadge.astro`, which is project-authored — move it out of `ui/` or allowlist it narrowly.

**Option B — ESLint `no-restricted-syntax`** with a `Literal` selector, no plugin needed. It slots into `eslint.config.js` alongside the existing `astroConfig` object and works in `.astro` because `eslint-plugin-astro` is already registered. Gains per-line `eslint-disable` escape hatches and editor squiggles; loses precision (fires on any string literal, not just class attributes). `eslint-plugin-better-tailwindcss` is the purpose-built alternative but adds a dependency and a v4 config surface — not worth it at this size.

**Recommendation: A now, B once the count is at zero** and the job shifts from _migrating_ to _holding_.

**Two cheap adjacent fixes:**

- `.prettierrc.json` loads `prettier-plugin-tailwindcss` but sets neither `tailwindStylesheet` nor `tailwindFunctions`. So the sorter doesn't know about project tokens and **does not sort class strings inside `cva()` or `cn()` at all** — exactly where this architecture puts them. Adding `"tailwindStylesheet": "./src/styles/global.css"` and `"tailwindFunctions": ["cva","cn"]` costs one reformat pass.
- **Delete `src/components/ui/sidebar.tsx`** — 682 dead lines that are 40% of the repo's `sidebar-*` token surface, so every future "where do sidebar colors live" search hits it first. Read `sidebarMenuButtonVariants` (`:450-470`) once as a reference for what `AppSidebar.astro` should look like, then delete.

#### 3.6 Where this is overkill — honest triage

| Category              | Files | Literals | Verdict                                                                                                                                                                      |
| --------------------- | ----: | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Genuinely needs cva   |     7 |      ~45 | `DeadlineCard.astro`, the four `*EntryList.tsx`, `EntriesTabs.tsx:57`, `FormField.tsx:53` — all have _conditional_ color driven by state, which is the only thing cva is for |
| Token rename only     |   ~20 |      ~70 | `EntryDetail.astro` is the extreme case: 23 literals but **two** strings → two `sed` invocations. Wrapping these in components would be strictly worse                       |
| Leave alone           |     4 |        4 | scrims + `button.tsx:14`                                                                                                                                                     |
| Needs a different fix |     1 |        9 | `Banner.astro`'s scoped `<style>` needs `var(--status-*)` directly — no grep rule and no cva touches it                                                                      |

**~70% rename, ~30% variant** — matching `change.md:33`'s own "~80/20" estimate. The variant layer is the interesting part and the small part. Set that expectation.

**The real risk is not overkill, it is silent failure.** A token in `:root` never aliased in `@theme inline`, or a dynamically-built class string, both produce a class that compiles to nothing — no error, no warning, only a visibly unstyled element. Mitigations in order of value: (a) edit `@theme inline` and `theme.ts` **in the same commit**, with cross-ref comments pointing at each other, mirroring `nav.ts:3`; (b) an E2E assertion on computed `background-color` for the three deadline states.

---

### 4. Verification gap — the biggest risk in the change

**A 38-file styling sweep has zero automated coverage of its own primary failure mode.**

What exists:

- **Unit** (`npm test`, Docker-free, run by pre-commit): 8 files, ~289 tests
- **Integration** (`npm run test:integration`, needs local Supabase): 5 files
- **E2E** (`npm run test:e2e`): `e2e/seed.spec.ts`, `e2e/cross-user-data-isolation.spec.ts`, `e2e/car-delete-blast-radius.spec.ts`, plus `auth.setup.ts` and fixtures

**No visual-regression tooling of any kind** — `toHaveScreenshot|toMatchSnapshot|toHaveClass|toHaveCSS` returns **zero hits** across `src/test`, `integration/`, and `e2e/`. Playwright is Chromium-only with `screenshot: "only-on-failure"`, deliberately: _"These tests protect application logic, not rendering differences."_

This is a **recorded decision**, `context/foundation/test-plan.md` §7:

> "**Visual / snapshot tests of static chrome** (sidebar, landing, layout) — brittle and low-signal for this UI-overhaul change. **Re-evaluate if a visual regression actually ships to users.**"

So the exclusion is not an oversight, and §7 pre-authorizes revisiting it.

What the existing suites _will_ catch: **accessible-name and DOM-structure changes**, since every E2E locator is role/label-based. Two live tripwires:

- `e2e/auth.setup.ts:58-60` and `e2e/fixtures/app.ts:165-167` **pin `lang=en`** via `context.addCookies`, because an inherited `lang=pl` broke name-based locators. **A theme cookie that changes rendered classes needs identical pinning**, or E2E runs become theme-dependent. `e2e/fixtures/app.ts:64` resets `storageState` per spec.
- `.claude/settings.json` defines a PostToolUse "R1 tripwire" hook that re-runs both AI specs whenever `ai.ts`, `chat.ts`, or either spec is edited — relevant because `ai/ChatDemo.tsx` is in bucket C.

Also flagged in `e2e/README.md`, adjacent to this work: `StreamingText.tsx`'s `animate-pulse` cursor has _"no `role`, no `aria-live`, no accessible name."_

Note **`context/foundation/test-plan.md` is stale** — §3 still lists E2E as `not started` and §4 records e2e as _"none yet"_, but Playwright and three specs exist. Last reviewed 2026-06-14.

---

## Code References

**Theme mechanics**

- `src/layouts/Layout.astro:14` — `<html lang={...}>`; the only place a theme class can be server-rendered
- `src/layouts/Layout.astro:15-20` — the shared `<head>`; the only home for an inline script
- `src/middleware.ts:38-41` — cookie → `locals` resolution, before any HTML is produced
- `src/middleware.ts:34-36` — comment explaining why non-optional `App.Locals` forces assignment outside the auth branch
- `src/middleware.ts:43-47` — `PROTECTED_ROUTES` gate, _after_ locale resolution
- `src/pages/api/lang/[locale].ts:11-19` — the exact cookie shape to copy
- `src/pages/api/cars/[id]/select.ts:45-50` — the same shape, second use
- `src/env.d.ts:1-7` — `App.Locals` typing
- `src/i18n/config.ts:4-6` — const-tuple + union + default triple
- `src/components/AppSidebar.astro:63-90` — the no-JS toggle form (theme toggle's home)
- `src/components/MobileSidebarTrigger.tsx:88-116` — its React duplicate
- `src/components/MobileSidebarTrigger.tsx:133` — lazy `useState` initializer; the no-flash idiom
- `src/hooks/use-mobile.ts:5-22` — closest analogue to a theme hook

**Tokens**

- `src/styles/global.css:4` — `@custom-variant dark (&:is(.dark *))`
- `src/styles/global.css:6-41` — `:root`, stock shadcn light
- `src/styles/global.css:31-32` — the now-false "app has no dark-mode toggle" comment
- `src/styles/global.css:33-40` — the 8 dark-only `--sidebar-*` vars
- `src/styles/global.css:43-67` — `.dark`, dead code today
- `src/styles/global.css:69-105` — `@theme inline`; `inline` is load-bearing
- `src/styles/global.css:97-104` — `--color-sidebar*` already registered (the free win)
- `src/styles/global.css:107-109` — `@utility bg-cosmic`, 3 raw hex
- `src/styles/global.css:115-117` — `body { @apply bg-background text-foreground }`

**Migration hot spots**

- `src/components/DeadlineCard.astro:11-31` — the traffic light
- `src/lib/services/entries.ts:306-315` — where status is computed
- `src/types.ts:103` — `DeadlineStatus` typed in color names
- `src/components/entries/InspectionEntryList.tsx:34` — the second domain meaning
- `src/components/auth/FormField.tsx:53` — live WCAG 1.4.11 failure
- `src/components/Banner.astro:28-40` — 9 raw hex in scoped CSS
- `src/components/Welcome.astro:10,14,18,25,33` — dark-only decoration
- `src/components/ui/button.tsx:7-33` — the good cva precedent
- `src/lib/nav.ts` — the config-as-data precedent for `theme.ts`
- `src/components/ui/sidebar.tsx` — 682 lines, zero importers

**Verification**

- `e2e/auth.setup.ts:58-60`, `e2e/fixtures/app.ts:165-167` — the `lang=en` cookie pin
- `vitest.config.ts:34-48` — unit project + `@` alias, ready for `theme.test.ts`

---

## Architecture Insights

1. **The cookie → locals → prop rail is the project's settled answer to persisted preference on this SSR stack.** Used twice (`lang`, `selected_car_id`), documented, and deliberately no-JS. A theme should follow it and justify its single divergence (`httpOnly` vs. the inline script) explicitly.
2. **Server-rendered attributes beat client hydration for anything that affects paint.** The locale flow doesn't flash _because_ the value is resolved before HTML exists. Streaming makes this stronger, not weaker — the `<head>` flushes early, so anything not in the server output is inherently late.
3. **The token indirection has exactly one correct shape** — raw value in `:root`/`.dark`, `--color-*` alias in `@theme inline` — and deviating fails silently rather than loudly.
4. **Domain vocabulary and palette vocabulary must be decoupled.** `DeadlineStatus = "red" | "yellow" | "green"` is the concrete cost of not having done this; one mapper function is the fix and prevents the same trap for inspection pass/fail.
5. **This change is establishing a convention, not following one.** There is no design-system doc, no palette decision, no token convention, and no accessibility standard anywhere in 18 archived changes. `change.md`'s contrast table is the first place ratios have ever been computed in this project. That makes the token contract, the `--border`/`--input` split, and the contrast table into the design system by default — worth stating in the plan.

---

## Historical Context (from prior changes)

- **`context/archive/2026-06-09-sidebar-navigation/plan-brief.md:26`** — _"Sidebar visual style | Dark/cosmic match (override CSS vars) | App is always dark; default shadcn sidebar is near-white and would look disconnected."_ And `plan.md:105`: _"The `.dark` overrides for these vars can be removed — the app does not use a dark-mode toggle."_ The rationale is **aesthetic coherence, not brand**, so keeping the sidebar black stays compatible with recorded intent — but review finding **F7** (`reviews/impl-review.md:86-93`) added the comment now living at `global.css:31-32`, which this change makes factually false.
- **Same change, `research.md:91`** — _"The glassmorphism card style (`border-white/10 bg-white/10 backdrop-blur-xl`) should be preserved as the content-card visual language."_ A settled decision this change reopens.
- **`context/archive/2026-06-10-i18n-en-pl/plan.md:10,48,50`** — the cookie→locals→prop rail, the "do not read asynchronously after mount" rule, and the full-reload rationale. Note this change has **no `research.md`**. `localStorage` appears nowhere in `context/` — never considered _or_ rejected for a preference.
- **`context/archive/2026-06-03-deadline-dashboard/plan-brief.md:22`** — _"Overdue + ≤30d = red; ≤90d = yellow; >90d = green | Standard maintenance reminder cadence."_ Deliberate as a domain semantic; the specific hues were not. Plan said **yellow**, implementation used **amber**. **No accessibility discussion at all** — no contrast, no color-blindness, no redundant non-color cue. The status dot (`DeadlineCard.astro:19-24`) is also color-only.
- **`context/archive/2026-06-08-root-routing-landing/plan.md:11,81`** — _"only the copy and structure need changing"_ / _"Keep the cosmic background, Topbar, and CTA button structure intact."_ `bg-cosmic` survived by explicit instruction, then became _more_ entrenched when `2026-06-09-sidebar-navigation` centralized it into `AppLayout.astro`. **Deleting it reverses a decision taken twice** — nothing argues for cosmic on the merits, it was inherited, but the plan should say it is undoing a deliberate preservation.
- **`context/archive/2026-08-24-swallowed-error-propagation/plan.md:150-158`** — the staging template for exactly this shape of work: _"Bottom-up, in dependency order… **Each phase leaves the tree green**: lint, `astro check`, and `npm test` all pass at every phase boundary, because `.husky/pre-commit` runs all three and will refuse the commit otherwise."_ Plus `plan-brief.md`: _"Phases 1 and 2 are the design work; 3–5 are largely mechanical once the helper exists."_ **This answers `change.md`'s sequencing question with in-repo precedent: tokens/design first, mechanical conversion after, one route family per phase.**
- **Same change, `reviews/impl-review.md:29-38`** — the **deliberate-break check**: a table of four sabotages with the count of tests each turned red, reverted after. The substitute for coverage when a sweep has weak automated verification. Also `:22-27` records honestly that the review was not independent.
- **Negative finding:** grepping all of `context/archive/` for `design system`, `design token`, `oklch`, `@theme`, `palette` returns hits **only** in `2026-06-09-sidebar-navigation`. `context/foundation/tech-stack.md` names no UI/design concerns. There is no prior art to follow.
- **`context/foundation/lessons.md` does not exist.**

---

## Related Research

- `context/changes/light-dark-mode/change.md` — the palette, contrast table, and the traffic-light collision analysis this document builds on
- `context/foundation/test-plan.md` §7 — the recorded exclusion of visual tests, with its "re-evaluate" clause (**stale**: §3/§4 predate the Playwright setup that now exists)
- `context/archive/2026-06-09-sidebar-navigation/` — the only prior change that touched `global.css`
- `context/archive/2026-08-24-swallowed-error-propagation/` — the phasing and deliberate-break-check template

---

## Open Questions

Resolved by this research (answers above): where `.dark` is set; how persistence works; whether the shadcn primitives need changes (**most do not** — `input`, `textarea`, `select`, `label`, `separator`, `skeleton`, `tooltip`, `scroll-area` are already fully tokenized; the problem is that `FormField.tsx` and `ChatDemo.tsx` _reimplement_ them by hand); and migration sequencing (in-repo precedent above).

Still open — genuine decisions for the plan:

1. **Does the theme follow `prefers-color-scheme` by default?** If yes, the three-state cookie plus an inline script is required, and `@custom-variant dark` needs extending to cover the media query. If no (fixed default, e.g. dark), the change becomes **pure server-rendered SSR with no client JS at all** — strictly simpler, and fully consistent with the locale rail.
2. **Does the glass survive?** `bg-white/10 backdrop-blur-xl` → opaque `--card`, or translucent? One decision, 7+ sites, and it determines whether `bg-cosmic` can be a flat token.
3. **What replaces `Welcome.astro`'s decoration?** Three blurred orbs, a star field, and tri-stop gradient headlines are dark-only by construction. No token expresses "decoration."
4. **`--status-*` need two values each** (solid dot fill + ~10% surface wash) and a **third text-safe variant ≥4.5:1** for `InspectionEntryList.tsx:34`. And `Banner.astro` needs a **`--status-info`** that does not exist in the proposed set.
5. **Is `no_data` `--muted` (recessed) or `--card` (equal)?** Currently indistinguishable from a real card.
6. **Do the hand-rolled controls get migrated or replaced?** Migrating `FormField.tsx`/`ChatDemo.tsx` classes is cheaper; adopting `ui/input.tsx`/`ui/textarea.tsx` is more work but fixes the 3:1 contrast bug for free.
7. **What is the verification substitute?** With no visual regression tooling and green suites through a white-on-white page, the plan needs either a per-phase two-mode manual screenshot pass, computed-style E2E assertions on the three deadline states, or an explicit acceptance that verification is manual.
8. **Are the three pre-existing bugs in scope?** Missing `--destructive-foreground`, `FormField.tsx:53`'s 3:1 failure, `EntryDetail.astro:116`'s sub-4.5:1 text. Fixing them is nearly free during the sweep; deferring them should be a stated choice.
9. **Does `DeadlineStatus` get renamed?** `"red" | "yellow" | "green"` → `"bad" | "warn" | "ok"` touches `src/types.ts`, the service, and possibly the DB. The `toneForDeadline` mapper makes this **optional** — recommend deferring it.
