---
bootstrapped_at: 2026-05-23T10:24:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: car-booklet
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: car-booklet
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

CarBooklet is a solo greenfield web app targeting a 3-week after-hours MVP with auth and an AI assistant as the two load-bearing feature flags. The `(web-app, js)` recommended default is `10x-astro-starter`, which ships Supabase (PostgreSQL + OAuth-compatible auth) and Cloudflare Pages/Workers (edge runtime + streaming responses) out of the box — covering FR-001 auth, all car and entry data models, and the NFR requiring continuous visible progress during AI queries. The starter passes all four agent-friendly gates: typed (TypeScript + Zod), convention-based (Astro file routing + Supabase SDK patterns), popular in JS training data, and well-documented. Bootstrapper confidence is first-class — valid CLI, expected to work smoothly with occasional manual steps. Payments, realtime, and background jobs are out of scope per PRD non-goals; auth and AI feature flags are set. Standard path taken; CI runs on GitHub Actions with auto-deploy-on-merge to Cloudflare Pages.

---

## Pre-scaffold verification

| Signal      | Value                                            | Severity   | Notes                                                          |
| ----------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------- |
| npm package | not run                                          | —          | cmd_template starts with `git clone`; npm step skipped         |
| GitHub repo | not run                                          | —          | `gh` CLI unavailable in environment; recency check skipped     |

---

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo without keeping its upstream git history)
**Exit code**: 0
**Files moved**: 20 (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `CLAUDE.md.scaffold`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (cwd `CLAUDE.md` preserved; scaffold copy sidelined)
**.gitignore handling**: moved silently (no pre-existing `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted (directory removed after move-up)

---

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** — range `5.6.3 - 5.8.0` (transitive via `@astrojs/cloudflare` or similar chain)
  - Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - CWE: CWE-770 (Allocation of Resources Without Limits or Throttling)
  - Fix available: yes (`npm audit fix`)
  - Direct: no (transitive)

#### MODERATE findings

- **@astrojs/check** — range `>=0.9.3` (direct)
  - Via: `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`
  - Fix: downgrade to `0.9.2` (semver-major breaking change)

- **@astrojs/language-server** — range `>=2.14.0` (transitive)
  - Via: `volar-service-yaml`
  - Fix: resolved by `@astrojs/check@0.9.2`

- **@cloudflare/vite-plugin** — range `<=0.0.0-fff677e35 || 0.0.7 - 1.37.2` (transitive)
  - Via: `miniflare`, `wrangler`, `ws`
  - Fix available: yes (`npm audit fix`)

- **miniflare** — range `<=0.0.0-fff677e35 || 3.20250204.0 - 4.20260518.0` (transitive)
  - Via: `ws`
  - Fix available: yes (`npm audit fix`)

- **volar-service-yaml** — range `<=0.0.70` (transitive)
  - Via: `yaml-language-server`
  - Fix: resolved by `@astrojs/check@0.9.2`

- **wrangler** — range `<=0.0.0-kickoff-demo || 3.108.0 - 4.93.0` (direct)
  - Via: `miniflare`
  - Fix available: yes (`npm audit fix`)

- **ws** — range `8.0.0 - 8.20.0` (transitive)
  - Advisory: GHSA-58qx-3vcg-4xpx — "ws: Uninitialized memory disclosure"
  - CVSS: 4.4 (AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:N/A:N)
  - CWE: CWE-908
  - Fix available: yes (`npm audit fix`)

- **yaml** — range `2.0.0 - 2.8.2` (transitive)
  - Advisory: GHSA-48c2-rrv3-qjmp — "yaml vulnerable to Stack Overflow via deeply nested YAML collections"
  - CVSS: 4.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L)
  - CWE: CWE-674
  - Fix: resolved by `@astrojs/check@0.9.2`

- **yaml-language-server** — transitive via `yaml`
  - Fix: resolved by `@astrojs/check@0.9.2`

#### LOW / INFO findings

None.

---

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge|
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

These hints are preserved in the audit trail for the future M1L4 skill ("Memory Architecture"). In v1, bootstrapper does not modify the scaffold based on feature flags, CI provider, or deployment target — those configuration steps belong to the future agent-context skill.

---

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` and decide whether to merge any content from the starter's CLAUDE.md into your existing one.
- Run `npm audit fix` to address the fixable moderate/high findings (10 total; none critical).
- Configure `.env.example` → `.env` with your Supabase credentials before running the dev server.
- Start the dev server with `npm run dev`.
