import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./env";

/**
 * Two genuinely authenticated users, so RLS — not a mock — decides every outcome.
 *
 * Each user holds their own anon client carrying their own JWT, which is what
 * makes PostgREST evaluate `auth.uid()` for real. This is the whole premise of
 * the suite: an isolation test written against a stubbed database proves that
 * the stub was written to agree with the test.
 */

/** Every client opts out of session persistence, so no state bleeds across files. */
const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, CLIENT_OPTIONS);
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLIENT_OPTIONS);
}

/**
 * The client type these factories actually produce.
 *
 * Derived from a concrete call rather than written as the bare `SupabaseClient`
 * export or as `ReturnType<typeof createClient>`: both resolve `createClient`'s
 * generics to different defaults than an actual call infers, and under
 * `strictTypeChecked` that gap surfaces as `no-unsafe-assignment`.
 */
export type TestClient = ReturnType<typeof anonClient>;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /**
   * Anon-key client carrying this user's JWT. Subject to RLS, exactly like the
   * client the app builds per request in `src/lib/supabase.ts`. This is the
   * client every assertion goes through.
   */
  client: TestClient;
}

export interface OneUser {
  user: TestUser;
  /** Service-role client. Same rules as `TwoUsers.admin` — never in an assertion. */
  admin: TestClient;
  /** Deletes the user. `ON DELETE CASCADE` takes their cars and entries with them. */
  dispose(): Promise<void>;
}

export interface TwoUsers {
  userA: TestUser;
  userB: TestUser;
  /**
   * Service-role client. **Never appears in an assertion.**
   *
   * It bypasses RLS, so standing it in for the user whose access is under test
   * would turn every isolation check into a false pass. Its three legitimate
   * jobs: create the users, delete them, and read back ground truth when
   * confirming a row survived a rejected write.
   */
  admin: TestClient;
  /** Deletes both users. `ON DELETE CASCADE` takes their cars and entries with them. */
  dispose(): Promise<void>;
}

/**
 * Collision-proof suffix. Timestamp keeps it readable and sortable; the uuid
 * slice keeps two re-runs inside the same millisecond from colliding.
 */
function runId(): string {
  return `${Date.now().toString()}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser(admin: TestClient, label: string): Promise<TestUser> {
  const suffix = runId();
  const email = `integration-${label}-${suffix}@carbooklet.test`;
  const password = `Integration-${suffix}!`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation link; not what any risk here is about
  });
  if (created.error) throw new Error(`could not create test user ${label}: ${created.error.message}`);
  const id = created.data.user.id;

  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign in test user ${label}: ${signedIn.error.message}`);

  // Positive control on the fixture itself. If the JWT were not attached, every
  // downstream isolation assertion would still "pass" — against zero rows for
  // everyone — and prove nothing. Fail here instead, where the cause is legible.
  if (signedIn.data.user.id !== id) {
    throw new Error(`test user ${label} signed in as a different user (${signedIn.data.user.id} !== ${id})`);
  }

  return { id, email, password, client };
}

/**
 * Create two users and hand back their clients plus an admin client.
 *
 * **Call this in `beforeAll`, not `beforeEach`.** `supabase/config.toml`
 * caps sign-ins at 30 per 5 minutes per IP, and this helper spends two of them.
 * Per-file scoping keeps the whole suite inside that budget while still giving
 * every file its own users — no state crosses a file boundary. Tests within a
 * file stay independent by seeding their own cars and entries with unique
 * marker strings (see `seed.ts`), never by sharing rows.
 *
 * If the suite outgrows the budget, raise the limit in `config.toml` rather
 * than pooling users across files.
 */
export async function withTwoUsers(): Promise<TwoUsers> {
  const admin = adminClient();
  const userA = await createTestUser(admin, "a");

  // A is already in `auth.users` at this point. If B's creation throws — a 429
  // off the sign-in cap, a container hiccup — nothing else will ever remove A:
  // emails carry a timestamp and a uuid, so no later run collides with it and
  // no teardown knows it exists. Roll A back here, and let the original error
  // through rather than the cleanup's.
  let userB: TestUser;
  try {
    userB = await createTestUser(admin, "b");
  } catch (err) {
    await admin.auth.admin.deleteUser(userA.id).catch(() => undefined);
    throw err;
  }

  return {
    userA,
    userB,
    admin,
    async dispose() {
      // Deleting rows by hand would be redundant: `cars.user_id` and every
      // `*_entries.user_id` are `REFERENCES auth.users(id) ON DELETE CASCADE`.
      const results = await Promise.all([admin.auth.admin.deleteUser(userA.id), admin.auth.admin.deleteUser(userB.id)]);
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        throw new Error(`could not tear down test users: ${failed.map((r) => r.error?.message).join("; ")}`);
      }
    },
  };
}

/**
 * Create a single user, for files that never need a second one.
 *
 * The isolation specs need two users because the whole claim is about a
 * boundary between them. The owner-path specs (`crud-integrity`,
 * `validation-constraints`) assert only about what the owner can do to their
 * own rows, and a second user there is provisioned, signed in, and never
 * looked at.
 *
 * That matters for the same reason the `beforeAll` note above matters:
 * `supabase/config.toml` caps sign-ins per IP, and every unused user spends
 * from a shared budget. Reaching for this helper keeps the suite's cost
 * legible as it grows — if a file needs one user, the code should say one.
 */
export async function withOneUser(): Promise<OneUser> {
  const admin = adminClient();
  const user = await createTestUser(admin, "a");

  return {
    user,
    admin,
    async dispose() {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`could not tear down test user: ${error.message}`);
    },
  };
}
