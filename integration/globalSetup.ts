import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./fixtures/env";

/**
 * Two guards, run once before any integration spec.
 *
 * These tests create and delete real users and write real rows. Pointed at a
 * cloud project they would do real damage, and no separate key name would stop
 * that — the suite deliberately reuses the app's own `SUPABASE_URL` /
 * `SUPABASE_KEY`, so *this check* is what makes that reuse safe.
 *
 * The second guard exists so "the stack is not running" fails here, once, with
 * a sentence telling you what to do — instead of surfacing as a 20-second
 * timeout inside whichever spec happened to run first.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** How long to wait for the local stack to answer before calling it down. */
const REACHABILITY_TIMEOUT_MS = 5_000;

function assertLocal(): URL {
  let url: URL;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL: ${SUPABASE_URL}`);
  }

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to run integration tests against a non-local Supabase.\n` +
        `  SUPABASE_URL is ${SUPABASE_URL} (host: ${url.hostname})\n\n` +
        `These tests create and delete real users and write real rows. Point\n` +
        `SUPABASE_URL at the local stack (http://127.0.0.1:54321, see\n` +
        `\`npx supabase status\`) before running them.`,
    );
  }

  return url;
}

async function assertReachable(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Local Supabase is not answering at ${SUPABASE_URL}.\n` +
        `  1. start Docker\n` +
        `  2. npx supabase start\n` +
        `  3. re-run npm run test:integration\n\n` +
        `  (underlying error: ${error instanceof Error ? error.message : String(error)})`,
    );
  }

  // PostgREST answers the root path with the OpenAPI document. Anything else —
  // most usefully a 401 — means something is listening but it is not the stack
  // these tests expect.
  if (!response.ok) {
    throw new Error(
      `Local Supabase answered ${response.status.toString()} at ${SUPABASE_URL}/rest/v1/.\n` +
        `SUPABASE_KEY may be stale — re-copy the anon key from \`npx supabase status\`.`,
    );
  }
}

export default async function setup(): Promise<void> {
  assertLocal();
  await assertReachable();
}
