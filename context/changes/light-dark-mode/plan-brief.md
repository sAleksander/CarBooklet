# Light/Dark Theme — Plan Brief

> Full plan: `context/changes/light-dark-mode/plan.md`
> Research: `context/changes/light-dark-mode/research.md`
> Change brief: `context/changes/light-dark-mode/change.md`

## What & Why

Replace the inherited 10x-starter appearance with a deliberate Renault-inspired token
system (yellow / black / white) and make light mode genuinely possible. Today the app is
dark-only _by accident, not by design_: the visible identity comes from a starter navy
gradient plus hardcoded `text-white` / `text-blue-100` utilities in 38 files, while the
CSS token layer underneath is untouched stock shadcn. Light mode isn't undefined — it is
currently impossible, because `text-white` on a light background is unreadable and the
`.dark` block has never once executed.

## Starting Point

The app is **a dark design painted on a _light_ token set**. `:root` is stock shadcn
light (`--background: oklch(1 0 0)`), `@layer base` applies it to `body`, then every page
covers it with `bg-cosmic`. So every shadcn primitive (`Input`, `Textarea`, `Select`)
resolves near-black text and near-white hairlines onto dark glass panels — a live
contrast defect today, not just migration debt. Nothing anywhere sets the `.dark` class,
so `global.css:43-67` is dead code. The migration surface is **38 files, 135 lines, 72
distinct color values** — larger than the 31 originally recorded, because that grep
requires a `[-/]` suffix and so misses bare `text-white`, raw hex, and `rgba()`.

## Desired End State

A user's theme preference is resolved server-side before any HTML exists and rendered
onto `<html>`; someone who has never chosen follows their OS `prefers-color-scheme`.
Both modes are complete and readable everywhere. Every color in `src/` outside
`src/components/ui/` resolves through a token, held at zero by a grep gate in pre-commit
and CI. Domain color (deadline urgency, inspection pass/fail) flows through one mapper
module, so the palette can move again without touching a component.

## Key Decisions Made

| Decision                | Choice                                                                            | Why                                                                                                                    | Source   |
| ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| Default theme           | Follow `prefers-color-scheme`, explicit override                                  | Honours the change's own premise — a light mode that actually reaches light-mode users, not one hidden behind a toggle | Plan     |
| Glass panels            | Opaque `--card`, delete `backdrop-blur-xl`                                        | Glass existed only to read against the gradient being deleted; `bg-white/10` is invisible on white                     | Plan     |
| Landing decoration      | Delete orbs + star field; flat black brand hero                                   | Reuses the accepted "black in both modes" sidebar precedent — no new token, no mode axis, no design spec needed        | Plan     |
| Status tokens           | Two per state (`--status-X` fill ≥3:1, `--status-X-ink` text ≥4.5:1) + `/10` wash | Minimum shape satisfying both WCAG thresholds; a single value mathematically cannot do dot _and_ text                  | Plan     |
| Hand-rolled controls    | Adopt `ui/input.tsx` / `ui/textarea.tsx`                                          | Deletes the parallel implementation rather than re-theming it; fixes the 3:1 border failure for free                   | Plan     |
| Pre-existing bugs       | Fix all three                                                                     | All sit inside lines the sweep edits anyway; a contrast table documenting knowingly-violated standards is worthless    | Plan     |
| Verification            | Manual, explicitly accepted                                                       | No visual-regression tooling adopted; recorded as an open risk rather than papered over                                | Plan     |
| Phasing                 | Design first, then one route family per phase                                     | In-repo precedent from `2026-08-24-swallowed-error-propagation`; each phase leaves the tree green                      | Research |
| Enforcement             | `lint:colors` grep gate in pre-commit + CI                                        | ~50 ms, zero dependencies, doubles as the sweep's progress meter                                                       | Research |
| `DeadlineStatus` rename | Deferred                                                                          | The `toneForDeadline` mapper is exactly what makes it unnecessary                                                      | Research |
| FOUC handling           | Server-rendered class; script only for the unset case                             | Middleware already resolves cookies before any HTML exists — an inline script is _not_ needed for stated preferences   | Research |

## Scope

**In scope:** the full `:root`/`.dark` palette and new tokens (`--accent-ink`,
`--status-*` + `-ink`, `--status-info`, `--status-idle`, the missing
`--destructive-foreground`); a `theme` cookie → middleware → `<html>` rail with a no-JS
toggle; `src/lib/theme.ts` as the domain→token mapper with cva variants; migration of all
38 files; deleting `bg-cosmic` and two dead files (`ui/sidebar.tsx`, `ui/LibBadge.astro`);
three pre-existing accessibility bugs; the `lint:colors` gate.

**Out of scope:** renaming `DeadlineStatus` in the DB and `src/types.ts`; visual-regression
tooling; the three shadcn modal scrims and `ui/button.tsx`'s contrast-locked `text-white`
(shadcn-owned); reopening the sidebar's always-dark decision; a third text token; a theme
toggle on the four sidebar-less pages; any React theme context.

## Architecture / Approach

Two layers carry the change. **CSS tokens** are declared twice — raw value in
`:root`/`.dark`, `--color-*` alias in `@theme inline` — and `inline` is load-bearing:
without it the alias resolves at `:root` once and freezes the light value so `.dark` never
reaches it. **`src/lib/theme.ts`** maps domain vocabulary to token vocabulary
(`toneForDeadline`, `toneForResult`) and holds cva variants for the ~30% of sites with
conditional color; the other ~70% are a straight rename. A dependency-free
`src/lib/theme-preference.ts` holds the rail's config so middleware doesn't pull in cva.

The preference itself follows the project's settled **cookie → locals → prop** rail,
already used twice for `lang` and `selected_car_id`, with a no-JS `<form method="POST">`
control. It diverges in exactly one place: the cookie is `httpOnly`, so no script can read
it — which is fine, because the script only ever runs when the class is _absent_.

## Phases at a Glance

| Phase                        | What it delivers                                                                         | Key risk                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Token foundation          | Full palette, `theme.ts` mappers + variants, dead-file removal, zero-diff sidebar rename | A missing `@theme inline` alias fails silently — no error, just an unstyled element           |
| 2. Theme rail (server-only)  | Cookie, middleware, `<html class>`, Light/Dark toggle. Unset → dark, so visually inert   | Middleware ordering; `App.Locals` non-optionality forces placement outside the auth branch    |
| 3. App shell & auth          | `bg-cosmic` deleted, glass → opaque card, `FormField` adopts `ui/input.tsx`              | Adopting the primitive shifts focus rings, height, padding — a real behavioral change         |
| 4. Dashboard & traffic light | `DeadlineCard` → cva; the brand/warning collision actually resolved                      | A 10% alpha wash is weakest on white; idle states must read as recessed                       |
| 5. Entries & chat            | The bulk rename, `--accent-ink` tab underline, `ChatDemo` → `ui/textarea.tsx`            | Largest file count; AI-spec tripwire hook fires on `ChatDemo` edits                           |
| 6. Landing & Banner          | Flat black hero; Banner's 9 raw hex → `var(--status-*)`                                  | Banner is plain CSS — no sweep and no grep rule over classes reaches it                       |
| 7. System preference & gate  | Inline script, "System" option, `color-scheme`, `lint:colors` at zero                    | The first `<script>` in the codebase; must be `is:inline` or Astro defers it and FOUC returns |

**Prerequisites:** none — no new dependencies, no schema change, no external access. Local
Supabase only for the integration suite, which this change does not touch.

**Estimated effort:** ~4–6 sessions across 7 phases. Phases 1–2 are the design and
mechanism work; 3–6 are largely mechanical once `theme.ts` exists; 7 is small but novel.

## Open Risks & Assumptions

- **Verification is manual by decision.** There is no visual-regression tooling and the
  existing suites stay green through a white-on-white page. The primary failure mode — a
  token missing its `@theme inline` alias, or a dynamically-built class string, both
  compiling to _nothing_ — is exactly what a human skims past. Accepted; mitigated by
  per-phase two-mode walkthroughs and by editing `global.css` and `theme.ts` in the same
  commit with cross-referencing comments.
- **The rail lands before the sweep completes.** Between Phases 2 and 6 an explicit Light
  choice shows an incompletely migrated app. Mitigated by `DEFAULT_THEME = "dark"` until
  Phase 7, so only users who deliberately opt in see it.
- **`--status-warn` (light) at 3.30:1 and `--input` (dark) at 3.00:1 are the thinnest
  margins.** Neither has room to move without recomputing.
- **Two recorded decisions are deliberately reversed**: glassmorphism as the card language
  (`2026-06-09-sidebar-navigation`) and preserving `bg-cosmic`
  (`2026-06-08-root-routing-landing`, then re-entrenched). Nothing argued for either on
  the merits; both were inherited from the starter.
- **`change.md`'s proposed dark `--destructive` was wrong** and is corrected in the plan:
  at `oklch(0.680 0.190 25)` a near-white button label measures **3.01:1**. Moved to
  `oklch(0.560 0.190 25)` for 4.91:1. Assume other values may need the same scrutiny if
  edited — the full recomputed table is in the plan.
- **This change _is_ the design system.** No prior palette, token convention, or
  accessibility standard exists in 18 archived changes, so the contract written here
  becomes the default by inheritance.

## Success Criteria (Summary)

- A user who has never chosen a theme gets the one their OS asks for, with no flash — and
  can override it explicitly and have that stick.
- Every route is legible and deliberate-looking in **both** modes, including the deadline
  traffic light, which no longer collides with brand yellow.
- `npm run lint:colors` reports zero, and pre-commit refuses a commit that reintroduces a
  hardcoded color.
