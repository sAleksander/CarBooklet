---
project: CarBooklet
researched_at: 2026-05-24T00:00:00Z
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro v6 + React v19
  runtime: Cloudflare Workers (workerd / @astrojs/cloudflare v13+)
  database: Supabase (external)
  auth: Supabase SSR (cookie-based)
  ai: OpenRouter (external, SSE streaming)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only candidate that requires zero adapter change — the project already ships `@astrojs/cloudflare` v13+, `wrangler.jsonc`, and `astro:env/server` for secrets, all of which map directly to the Workers runtime. SSE streaming (required by the PRD for continuous AI response progress) is natively supported with no configuration. The free tier covers 3 million requests/month, but the $5/month paid plan is the practical floor given the 10ms CPU cap on the free tier for SSR workloads. Three anti-bias lenses confirmed the risks are operational (CI pipeline audit, CJS dependency trap, bundle size) rather than architectural — all mitigable before first deploy.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Notes |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | No adapter change; `astro:env` native; SSE native |
| Vercel | Pass | Pass | Pass | Pass | Pass | Adapter change; $20/mo Pro for commercial; 10s Hobby timeout kills AI streams |
| Netlify | Partial | Pass | Pass | Pass | Pass | Adapter change; SSE only on Edge Functions (Deno); no CLI rollback |
| Railway | Partial | Pass | Partial | Pass | Partial | Adapter change; no CLI rollback; beta MCP; $10-15/mo |
| Fly.io | Pass | Partial | Fail | Pass | Partial | Adapter change; `astro:env` incompatible; no free tier; MCP experimental |
| Render | Partial | Pass | Pass | Partial | Pass | **Eliminated**: SSE unreliable (nginx buffering); AI streaming blocked |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

The project's tech stack is built around the `workerd` runtime: `@astrojs/cloudflare` v13+ handles the Astro adapter, `wrangler.jsonc` configures the Worker, and `astro:env/server` manages secrets natively through Cloudflare's secret store. No code changes are needed to deploy. SSE streaming — the PRD's load-bearing requirement for visible AI progress — works out of the box via native `ReadableStream`. The free tier handles 100k requests/day (3M/month) at zero cost; the paid Standard plan at $5/month removes the 10ms CPU cap. Cloudflare provides 16+ official MCP servers covering Workers deployments, observability, and docs, and publishes `llms.txt` plus per-page Markdown for every docs page — the best agent-readable documentation surface of any platform evaluated.

Key constraint: Cloudflare Pages for SSR was deprecated in April 2025. The project's `tech-stack.md` says `cloudflare-pages` but the correct target is Workers. The `wrangler.jsonc` already reflects Workers; the CI pipeline needs auditing.

#### 2. Vercel

Vercel scores identically to Cloudflare on all five criteria and has an excellent `@astrojs/vercel` adapter (GA, v10.0.7). The official MCP server (GA as of Feb 2026) provides Claude Code integration. However, three factors push it to runner-up: (1) switching from `@astrojs/cloudflare` to `@astrojs/vercel` requires an adapter change and config restructuring; (2) the Hobby plan is explicitly non-commercial, making Pro at $20/month the realistic floor — 4× the cost of Cloudflare; (3) Fluid Compute (needed for AI streams longer than 10 seconds) is Pro-only, meaning the free tier cannot reliably serve AI responses.

#### 3. Netlify

Netlify has the strongest MCP story after Cloudflare and a well-maintained `@astrojs/netlify` v7 adapter with Astro v6 day-one support. The `netlify logs --follow` command (GA May 2026) rounds out the CLI surface. The gap vs. the top two: SSE streaming on standard Netlify Functions has a 30-second hard timeout and is unreliable for long AI responses — routing SSE through Edge Functions (Deno-based) is required, which is an architectural constraint not present in the other two shortlisted options. Additionally, there is no CLI rollback command (UI only), and `import.meta.env` secrets are inlined at build time and trigger Netlify's secret scanner.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The free tier's 10ms CPU cap is effectively unusable for SSR.** A server-rendered Astro page running Supabase auth middleware, querying the dashboard, and rendering React components easily exceeds 10ms CPU. The $5/month paid plan is the real deployment floor — "free" is a dev-only tier.
2. **CJS-only dependency trap is invisible locally.** Even with Astro 6's `astro dev` running on `workerd`, some tooling paths fall back to Node.js. Any npm package shipping only CommonJS (no ESM) passes local tests and fails at runtime on the deployed Worker. Supabase SSR and OpenRouter are ESM-compatible, but transitive dependencies may not be — discovery is painful.
3. **The CI pipeline likely targets Cloudflare Pages, not Workers.** `tech-stack.md` says `deployment_target: cloudflare-pages`; the bootstrapped GitHub Actions workflow may use `wrangler pages deploy`. That command succeeds silently while deploying to the wrong target. The pipeline needs auditing before first real deploy.
4. **Workers bundle size limit.** Free tier: 10 MB compressed. Paid: 25 MB. An Astro v6 SSR bundle with React 19, Supabase SDK, and an AI streaming SDK can approach the free-tier cap if tree-shaking is incomplete.
5. **Cloudflare Access adds cost to preview URL protection.** Workers preview deployments are public by default. Restricting them requires Cloudflare Access at $3/user/month — a hidden cost for a typical PR-preview workflow.

### Pre-Mortem — How This Could Fail

The first deploy to Cloudflare Workers went smoothly — `wrangler deploy` worked, the app loaded, and the dashboard displayed correctly. But within two weeks, the CPU time limit on the free tier began causing intermittent 503s during peak usage. Upgrading to $5/month fixed it, but the error messages from `wrangler tail` were cryptic and took days to diagnose because the issue only appeared under the Cloudflare runtime, not in local `astro dev`.

The deeper problem surfaced a month later when adding an AI library pulled in a transitive dependency that shipped only CommonJS. The error — `require() is not a function` — appeared at runtime in production but not locally, because `astro dev` still falls back to Node.js for certain tooling paths. The fix required manual bundler configuration that consumed three evenings.

The final blow was the CI pipeline. The GitHub Actions workflow had been deploying to the deprecated Cloudflare Pages target all along, not Workers. The developer only noticed when the production URL served stale content after a feature update. The pipeline had to be rewritten from scratch.

### Unknown Unknowns

- **`wrangler deploy` and `wrangler pages deploy` are silent about each other's target.** Both commands succeed without error even when pointed at the wrong asset type. The `.github/workflows/ci.yml` in this bootstrapped project needs auditing against the current Workers deploy path before the first real deployment.
- **`astro:env` validation runs at build time.** If `SUPABASE_URL` or `SUPABASE_KEY` are absent as Wrangler secrets at deploy time, the build fails with a message attributing the error to `astro:env`, not to a missing secret — this misdirects debugging.
- **`waitUntil()` is the only post-response extension point.** Unlike Node.js, Workers terminate the isolate after the response is sent. Fire-and-forget async tasks (analytics, cache warming) must use `ctx.waitUntil()` — if not, they are silently dropped.
- **`nodejs_compat` flag is required but not automatic.** The `wrangler.jsonc` must include `compatibility_flags: ["nodejs_compat"]` or Supabase SDK methods using `node:crypto` and `node:buffer` will throw at runtime. Verify this flag is present in the project's `wrangler.jsonc` before first deploy.
- **KV propagation lag matters if caching is ever added.** Cloudflare KV has up to 60 seconds eventual-consistency propagation. Cookie-based sessions (used by this project) are safe, but adding KV for caching later introduces a footgun where logged-out users remain "logged in" for up to 60 seconds on cache hits.

## Operational Story

- **Preview deploys**: Each `wrangler deploy` targeting a non-production environment creates a versioned Worker URL (e.g., `<hash>.carbooklet.workers.dev`). Preview URLs are public by default — no authentication gate. Adding Cloudflare Access protection costs $3/user/month and requires a Zero Trust account setup.
- **Secrets**: Managed via `wrangler secret put <NAME>` (interactive) or `echo "value" | wrangler secret put <NAME>` (scriptable). Secrets are encrypted at rest by Cloudflare and injected at runtime. For CI/CD, set `CLOUDFLARE_API_TOKEN` as a GitHub repository secret; the Actions workflow reads it automatically. `astro:env/server` reads secrets at request time, not build time.
- **Rollback**: `wrangler rollback` reverts to the previous Worker version. For a specific version: `wrangler rollback <VERSION_ID>` (list versions with `wrangler versions list`). Gradual rollout and rollback are available via `wrangler deploy --x-versions`. Time-to-revert is typically under 30 seconds. Database migrations (Supabase) do not roll back automatically — schema migrations must be reversible or guarded independently.
- **Approval**: The agent may run `wrangler deploy`, `wrangler tail`, `wrangler versions list`, and `wrangler rollback` unattended. Human-only operations: rotating `SUPABASE_KEY` or `CLOUDFLARE_API_TOKEN`, deleting the Worker project, modifying DNS records or Cloudflare Access policies, and any Supabase schema migration that drops columns or tables.
- **Logs**: `wrangler tail` streams live request logs to stdout. Filter by status: `wrangler tail --status error`. Structured JSON output: `wrangler tail --format json`. Cloudflare's Observability MCP server (`cloudflare-observability` via Claude Code MCP config) provides structured log queries and analytics without parsing CLI output.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CI pipeline deploys to Pages instead of Workers | Unknown unknowns | H | M | Audit `.github/workflows/ci.yml` before first deploy; replace `wrangler pages deploy` with `wrangler deploy` |
| 10ms CPU cap causes 503s on free tier | Devil's advocate | H | M | Upgrade to $5/month Standard plan before launch; keep free tier for dev only |
| CJS-only transitive dependency breaks runtime | Devil's advocate | M | H | Run `wrangler deploy --dry-run` and inspect bundle; add `"moduleResolution": "bundler"` + ESM-only dependency policy |
| `nodejs_compat` flag missing from `wrangler.jsonc` | Unknown unknowns | M | H | Verify flag is present before first deploy; add to `wrangler.jsonc` if absent |
| Bundle size exceeds 10 MB free-tier limit | Devil's advocate | L | M | Upgrade to paid plan (25 MB limit); use `wrangler deploy --dry-run` to check bundle size |
| `astro:env` build failure masking missing secret | Unknown unknowns | M | L | Set all required secrets via `wrangler secret put` before first CI deploy; add secret presence check to CI steps |
| CI CPU time exceeded in 503-pattern unclear from logs | Pre-mortem | M | M | Enable Cloudflare Analytics and Observability MCP for structured error queries beyond `wrangler tail` |
| Preview URLs exposed without auth | Research finding | L | L | Accept for MVP (solo dev, no sensitive pre-release data); add Cloudflare Access before public beta |
| KV propagation lag if caching added later | Unknown unknowns | L | M | Document footgun; prefer cookie/header-based invalidation over KV for auth state |

## Getting Started

The project already has `wrangler.jsonc` and `@astrojs/cloudflare` configured. The sequence below covers the gaps between bootstrap and first live deploy:

1. **Verify `wrangler.jsonc` prerequisites** — confirm `compatibility_flags: ["nodejs_compat"]` is present and the `name` field matches the intended Worker name. If absent, add the flag before deploying.

2. **Authenticate Wrangler** — run `npx wrangler login` (opens OAuth in browser; one-time per machine). Verify with `npx wrangler whoami`.

3. **Set production secrets** — push both secrets to Cloudflare:
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   These are now encrypted at rest and injected at request time via `astro:env/server`.

4. **Deploy** — from the project root:
   ```
   npm run build
   npx wrangler deploy
   ```
   The CLI prints the live Worker URL (e.g., `https://car-booklet.<account>.workers.dev`). Verify the app loads and auth works.

5. **Audit and fix the CI pipeline** — open `.github/workflows/ci.yml`. Replace any `wrangler pages deploy` call with `wrangler deploy`. Add `CLOUDFLARE_API_TOKEN` as a GitHub repository secret (create a scoped token at `dash.cloudflare.com` → My Profile → API Tokens → "Edit Cloudflare Workers" template). Add `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the CI build step.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline full setup (beyond the audit noted in Getting Started)
- Production-scale architecture (multi-region, HA, DR)
- Custom domain configuration and DNS routing
