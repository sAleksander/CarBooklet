// Test double for the `astro:env/server` virtual module, wired in via
// `resolve.alias` in vitest.config.ts. Exposes the same named exports
// (astro.config.mjs:18-22) so services importing them resolve under test.
// Each falls back to a non-empty placeholder so e.g. `new OpenAI({ apiKey })`
// constructs during module evaluation rather than throwing.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54321";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "test-supabase-key";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "sk-or-test-placeholder";
