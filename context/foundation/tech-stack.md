---
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
---

## Why this stack

CarBooklet is a solo greenfield web app targeting a 3-week after-hours MVP with auth and an AI assistant as the two load-bearing feature flags. The `(web-app, js)` recommended default is `10x-astro-starter`, which ships Supabase (PostgreSQL + OAuth-compatible auth) and Cloudflare Pages/Workers (edge runtime + streaming responses) out of the box — covering FR-001 auth, all car and entry data models, and the NFR requiring continuous visible progress during AI queries. The starter passes all four agent-friendly gates: typed (TypeScript + Zod), convention-based (Astro file routing + Supabase SDK patterns), popular in JS training data, and well-documented. Bootstrapper confidence is first-class — valid CLI, expected to work smoothly with occasional manual steps. Payments, realtime, and background jobs are out of scope per PRD non-goals; auth and AI feature flags are set. Standard path taken; CI runs on GitHub Actions with auto-deploy-on-merge to Cloudflare Pages.
