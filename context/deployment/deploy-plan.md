---
project: CarBooklet
created_at: 2026-05-24
target_platform: Cloudflare Workers
wrangler_version: "^4.90.0"
astro_version: "^6.3.1"
adapter: "@astrojs/cloudflare@^13.5.0"
status: first-deploy-complete
workers_url: https://car-booklet.carbooklet.workers.dev
---

# CarBooklet — First Deployment Plan

Cloudflare Workers (SSR). `wrangler deploy`. CI auto-deploy on merge to `main`.

This document is the authoritative audit trail for the first production deployment.
Every step is marked either **[HUMAN GATE]** (must be done manually by the developer,
cannot be delegated to an agent) or **[AUTOMATED]** (can be run by an agent or CI).

---

## 0. Pre-Flight Checklist

Confirm all of the following before touching any deploy command.

| # | Check | Expected state | Actual state |
|---|-------|---------------|--------------|
| 1 | `wrangler.jsonc` → `name` | `"car-booklet"` | `"car-booklet"` ✅ (fixed) |
| 2 | `wrangler.jsonc` → `compatibility_flags` | `["nodejs_compat"]` | present ✅ |
| 3 | `wrangler.jsonc` → `main` | `"@astrojs/cloudflare/entrypoints/server"` | present ✅ |
| 4 | `wrangler.jsonc` → `assets.directory` | `"./dist"` | present ✅ |
| 5 | `astro.config.mjs` → `adapter` | `cloudflare()` | present ✅ |
| 6 | `astro.config.mjs` → `output` | `"server"` | present ✅ |
| 7 | CI branch trigger | `main` | `main` ✅ (fixed) |
| 8 | CI deploy step | exists | present ✅ (fixed) |
| 9 | GitHub remote branch | `main` | `main` ✅ |
| 10 | Supabase project | cloud URL + anon key known | GATE — see §1-A |

---

## 1. Manual Setup Gates

These steps must be completed by a human before any automated deploy step runs.
None of them can be delegated to an agent.

### GATE A — Supabase Project [HUMAN GATE]

**Why this is a gate**: The app uses Supabase for auth. Without a real Supabase project,
sign-up, sign-in, and the dashboard are broken. The `src/lib/supabase.ts` client
degrades gracefully (returns `null` when vars are missing), so the app will _load_
without Supabase — but auth will silently fail on every request.

**Options**:

1. **Cloud Supabase (required for production)**
   - Go to https://supabase.com and create a new project named `car-booklet`.
   - From the project dashboard → Settings → API, copy:
     - **Project URL** → this becomes `SUPABASE_URL`
     - **anon public** key → this becomes `SUPABASE_KEY`
   - Record both values in your password manager — you will need them in §1-C and §1-D.

2. **Local Supabase (dev/testing only, NOT reachable from deployed Worker)**
   - From project root: `npx supabase start`
   - Local URL: `http://127.0.0.1:54321`, anon key: printed by `supabase start`.
   - Local Supabase is NOT accessible from a deployed Cloudflare Worker — use cloud for any deployed environment.

**Gate complete when**: you have `SUPABASE_URL` and `SUPABASE_KEY` values in hand.

---

### GATE B — Cloudflare Account + Wrangler Login [HUMAN GATE]

```bash
npx wrangler login
```

This opens a browser OAuth flow. Complete it on the Cloudflare account that will own
the production Worker. Verify with:

```bash
npx wrangler whoami
```

Expected output includes your Cloudflare account name and account ID.
Copy the **Account ID** — you will need it in §1-D.

**Gate complete when**: `npx wrangler whoami` returns your account details without error.

---

### GATE C — Set Worker Secrets (Production) [HUMAN GATE]

Push both secrets to the Cloudflare Worker before first deploy. These are encrypted
at rest by Cloudflare and injected at request time via `astro:env/server`.

```bash
npx wrangler secret put SUPABASE_URL
# Paste the Project URL from §1-A when prompted. Press Enter.

npx wrangler secret put SUPABASE_KEY
# Paste the anon key from §1-A when prompted. Press Enter.
```

Verify:

```bash
npx wrangler secret list
```

Expected output:

```
Name           Created
SUPABASE_KEY   <timestamp>
SUPABASE_URL   <timestamp>
```

**Important**: `wrangler secret put` targets the Worker named in `wrangler.jsonc`
(`"car-booklet"`). Ensure §0 check #1 is confirmed before running this gate.

**Gate complete when**: both secrets appear in `wrangler secret list`.

---

### GATE D — GitHub Repository Secrets for CI [HUMAN GATE]

CI needs four secrets to run the full lint + build + deploy pipeline.

Go to: GitHub repository → Settings → Secrets and variables → Actions → New repository secret.

| Secret name | Value | Source |
|-------------|-------|--------|
| `CLOUDFLARE_API_TOKEN` | Scoped Cloudflare API token | Created below |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID | From §1-B (`wrangler whoami`) |
| `SUPABASE_URL` | Supabase Project URL | From §1-A |
| `SUPABASE_KEY` | Supabase anon key | From §1-A |

**Creating the scoped Cloudflare API token**:
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use the **"Edit Cloudflare Workers"** template
4. Under "Account Resources", restrict to the account that owns `car-booklet`
5. Under "Zone Resources", select "All zones" (or restrict to your domain if known)
6. Click "Continue to summary" → "Create Token"
7. Copy the token value immediately — it is shown only once.
8. Paste it as the value for `CLOUDFLARE_API_TOKEN` in GitHub secrets.

**Why a scoped token**: the CI agent can deploy Workers but cannot modify DNS,
Access policies, or other Cloudflare resources if the token leaks.

**Gate complete when**: all four GitHub repository secrets are saved.

---

## 2. First Manual Deploy Sequence

Run this once locally, after all gates in §1 are complete. This establishes the Worker
in Cloudflare's system before CI takes over.

**[AUTOMATED] — run locally by developer**

```bash
# 1. Confirm wrangler.jsonc name is "car-booklet"
grep '"name"' wrangler.jsonc

# 2. Confirm secrets are present
npx wrangler secret list

# 3. Build
npm run build

# 4. Deploy
npx wrangler deploy
```

Expected output from step 4:

```
Uploaded car-booklet (X.XXs)
Deployed car-booklet triggers (X.XXs)
  https://car-booklet.<your-account>.workers.dev
```

**Production URL**: https://car-booklet.carbooklet.workers.dev ✅ (deployed 2026-05-24)

---

## 3. Verification Steps

After first deploy (and after every subsequent CI deploy), verify the following.

### 3-A — App Loads [AUTOMATED]

```bash
curl -I https://car-booklet.carbooklet.workers.dev/
```

Expected: `HTTP/2 200`

### 3-B — Auth Pages Render [AUTOMATED]

```bash
curl -s https://car-booklet.carbooklet.workers.dev/auth/signup | grep -i "sign"
curl -s https://car-booklet.carbooklet.workers.dev/auth/signin | grep -i "sign"
```

Both should return 200 and render form HTML.

### 3-C — Dashboard Redirect (Middleware Test) [AUTOMATED]

```bash
curl -I https://car-booklet.carbooklet.workers.dev/dashboard
```

Expected: `HTTP/2 302` with `location: /auth/signin`

This confirms `src/middleware.ts` is executing correctly on the Worker runtime. The
`PROTECTED_ROUTES = ["/dashboard"]` guard must redirect unauthenticated requests.

### 3-D — Sign-Up and Sign-In Flow [HUMAN GATE — requires Supabase]

1. Go to `/auth/signup`, register a new account.
2. Check email for confirmation link. Click it (or disable email confirmation in Supabase dashboard → Authentication → Email → Confirm email: off).
3. Go to `/auth/signin`, sign in with the new account.
4. Confirm redirect to `/dashboard` after successful sign-in.

This test requires `SUPABASE_URL` and `SUPABASE_KEY` to be set as Worker secrets (§1-C)
and a working cloud Supabase project (§1-A).

### 3-E — Live Log Streaming [AUTOMATED]

In a separate terminal while performing 3-C/3-D:

```bash
npx wrangler tail
```

Every request should appear as a structured log line. Errors only:

```bash
npx wrangler tail --status error
```

Structured JSON output:

```bash
npx wrangler tail --format json
```

**Verification complete when**: all five checks (3-A through 3-E) pass.

---

## 4. CI/CD Verification

After merging the CI workflow update to `main`:

1. Go to GitHub repository → Actions → most recent workflow run.
2. Confirm the `ci` job runs (lint, build).
3. Confirm the `deploy` job runs after `ci` succeeds (push to main only).
4. The `cloudflare/wrangler-action@v3` step should print the Worker URL.
5. Confirm the deployed URL reflects the merged changes.

**To verify PRs do NOT trigger deploy**: open a test PR, confirm only `ci` runs.
The `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` condition
on the `deploy` job prevents it from running on PRs.

---

## 5. Rollback Procedure

### Immediate rollback (previous version) [AUTOMATED]

```bash
npx wrangler rollback
```

Reverts to the version immediately before the current deployment. Time-to-revert is
typically under 30 seconds. No redeploy is required.

### Rollback to a specific version [AUTOMATED]

```bash
# 1. List all deployed versions with their IDs
npx wrangler versions list

# 2. Roll back to a specific version ID from the list
npx wrangler rollback <VERSION_ID>
```

### What rollback does NOT cover

- **Supabase schema migrations**: database changes do not roll back with `wrangler rollback`.
  Design all migrations to be reversible. Never merge a migration that drops columns
  or tables without a rollback migration file ready.
- **Secrets**: `wrangler rollback` reverts Worker code, not secrets. If a secret was
  rotated as part of a deploy, re-rotate it manually to restore the old value.

---

## 6. Post-First-Deploy Notes

### REQUIRED before real user traffic: Upgrade to Paid Plan [HUMAN GATE]

The Cloudflare Workers **free tier has a 10ms CPU cap** per request. An SSR Astro page
running Supabase auth middleware (cookie parsing, JWT verification) and React rendering
will exceed 10ms on most requests, causing intermittent 503 errors.

**Before sharing the URL with any real user**:
1. Go to https://dash.cloudflare.com → Workers & Pages → Overview
2. Click "Manage Plan" on the `car-booklet` Worker
3. Upgrade to **Standard plan at $5/month**

The Standard plan removes the CPU cap. The free tier is suitable for the §3 verification
steps only.

### Custom Domain (post-MVP) [HUMAN GATE]

The `.workers.dev` URL is functional but not user-facing. To add a custom domain:
1. Ensure the domain's DNS is managed by Cloudflare (or transfer it).
2. Workers → `car-booklet` → Triggers → Custom Domains → add your domain.
3. Cloudflare provisions TLS automatically.

### Bundle Size Monitoring [AUTOMATED]

```bash
npx wrangler deploy --dry-run --outdir ./dist-dry
ls -lh ./dist-dry/
```

Free tier limit: 10 MB compressed. Paid tier limit: 25 MB. If approaching limits,
audit for CJS-only transitive dependencies or enable more aggressive tree-shaking.

---

## 7. Operations Reference

| Task | Command | Who |
|------|---------|-----|
| Deploy manually | `npm run build && npx wrangler deploy` | Agent / Developer |
| View live logs | `npx wrangler tail` | Agent / Developer |
| View error logs | `npx wrangler tail --status error` | Agent / Developer |
| List deployed versions | `npx wrangler versions list` | Agent / Developer |
| Rollback to previous | `npx wrangler rollback` | Agent / Developer |
| Rollback to version | `npx wrangler rollback <VERSION_ID>` | Agent / Developer |
| List secrets | `npx wrangler secret list` | Agent / Developer |
| Add / rotate secret | `npx wrangler secret put <NAME>` | **Human only** |
| Change DNS / custom domain | Cloudflare dashboard | **Human only** |
| Supabase schema migration (drop) | Supabase dashboard / CLI | **Human only** |
| Rotate API tokens | Cloudflare dashboard | **Human only** |
| Upgrade billing plan | Cloudflare dashboard | **Human only** |

---

## Appendix A — Dependency Order

Steps must be completed in this order:

```
§1-A (Supabase project)
  └─→ §1-B (wrangler login)
        └─→ §1-C (wrangler secret put — targets "car-booklet")
              └─→ §1-D (GitHub repository secrets)
                    └─→ §2 (first manual deploy)
                          └─→ §3 (verification)
                                └─→ §4 (CI/CD verification via merged PR)
```

§1-D (GitHub secrets) can be added at any point after §1-A, but CI deploys will
silently fail until the Worker is first deployed manually (§2).

---

## Appendix B — Known Issues at Time of Writing (2026-05-24)

| Issue | Location | Severity | Status |
|-------|----------|----------|--------|
| Worker name was `10x-astro-starter` | `wrangler.jsonc` line 3 | Blocker | **Fixed** ✅ |
| CI triggered on `master` not `main` | `.github/workflows/ci.yml` | Blocker | **Fixed** ✅ |
| No CI deploy step | `.github/workflows/ci.yml` | Blocker | **Fixed** ✅ |
| `package.json` name still `10x-astro-starter` | `package.json` | Cosmetic | Optional — not required for deploy |
