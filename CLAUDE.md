# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

For commands look up @README.md

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and
`prettier --write` on `*.{json,css,md}`.

## Architecture

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages and API routes are
server-rendered by default.

### Auth flow

- `src/lib/supabase.ts` — Supabase SSR client via `@supabase/ssr`, cookie-based sessions.
  Uses `astro:env/server` for secrets — SUPABASE_URL/SUPABASE_KEY are never exposed to client code.
- `src/middleware.ts` — resolves current user on every request, attaches to `context.locals.user`.
  Redirects unauthenticated users away from routes in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions

- **Path alias**: `@/*` → `./src/*` (tsconfig paths).
- Never use React for non-interactive sections — .astro components only for layout and static content
- **Tailwind class merging**: use `cn()` from `@/lib/utils` (clsx + tailwind-merge). No manual class string concatenation.
- **shadcn/ui**: components in `src/components/ui/`, "new-york" style. Add with `npx shadcn@latest add [name]`.
- **API routes**: uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` with `YYYYMMDDHHmmss_short_description.sql`. Enable RLS on every new table with per-operation, per-role policies.
- **React**: no Next.js directives ("use client"). Extract hooks to `src/components/hooks/`.
- **Services/helpers**: `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs): `src/types.ts`.

## Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` — copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev
- Local Supabase: `npx supabase start` (requires Docker, ~7 GB RAM)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler login`)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint + build on push/PR to master.
Requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
