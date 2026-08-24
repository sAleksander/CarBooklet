/**
 * Credentials for the integration test process.
 *
 * Integration runs against the **local** Supabase stack (`npx supabase start`),
 * never a cloud project — the tests create and delete real users. `integration/globalSetup.ts`
 * enforces that; this module only reads.
 *
 * The service-role key is required for user seeding and teardown only. It
 * bypasses RLS, so it must never be imported by anything under `src/`. That
 * rule — inherited from `e2e/fixtures/env.ts` — is the reason this suite lives
 * in a top-level `integration/` directory rather than under `src/test/`.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env on disk is fine when the vars are already exported (e.g. CI).
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Integration tests need the local Supabase stack:\n` +
        `  1. start Docker\n` +
        `  2. npx supabase start\n` +
        `  3. copy the printed keys into .env (see .env.example)`,
    );
  }
  return value;
}

export const SUPABASE_URL = required("SUPABASE_URL");

/**
 * The app's `SUPABASE_KEY` *is* the anon key — `src/lib/supabase.ts` passes it
 * straight to `createServerClient`. Aliased here so call sites read as
 * "the key a browser would hold", which is the whole point: an anon client is
 * subject to RLS, and RLS is what these tests are about.
 */
export const SUPABASE_ANON_KEY = required("SUPABASE_KEY");

export const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
