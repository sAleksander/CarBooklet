/**
 * Credentials for the E2E test process.
 *
 * E2E runs against the **local** Supabase stack (`npx supabase start`), never a
 * cloud project — the tests create and delete real users. The app's dev server
 * loads `.env` through Vite; this test process has to load it itself.
 *
 * The service-role key is required for user seeding/teardown only. It bypasses
 * RLS, so it must never be imported by anything under `src/`.
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
      `${name} is not set. E2E needs the local Supabase stack:\n` +
        `  1. start Docker\n` +
        `  2. npx supabase start\n` +
        `  3. copy the printed keys into .env (see .env.example)`,
    );
  }
  return value;
}

export const SUPABASE_URL = required("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
