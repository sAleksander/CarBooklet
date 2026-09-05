import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror tsconfig.json `@/*` → `./src/*`. Both projects need it: the unit
// project because the specs import through `@`, the integration project
// because the service functions under test import `@/types`.
const atAlias = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    // Root-level, because Vitest rejects it inside a project config. Harmless
    // for `integration`, which always has specs; it exists for `unit`, whose
    // runner was stood up before any spec did.
    passWithNoTests: true,

    // Three projects, because the three suites have incompatible prerequisites.
    //
    // `unit` must stay runnable with Docker stopped — `.husky/pre-commit` runs
    // `npm test`, and a pre-commit hook that needs a database is a pre-commit
    // hook people start bypassing. `integration` needs a live local Supabase
    // and is opted into explicitly via `npm run test:integration`.
    //
    // `client` needs a DOM, which the other two must not pay for: `environment:
    // "jsdom"` costs real startup time per file and would buy nothing for a
    // route handler or a service function. It is still Docker-free, so it joins
    // `unit` in the pre-commit path — the streaming hook is exactly the kind of
    // code where a regression is invisible until a user sees it.
    //
    // The split is by directory, not by filename convention, so a spec cannot
    // drift into the wrong project by being named carelessly.
    projects: [
      {
        resolve: {
          alias: {
            "@": atAlias,
            // `astro:env/server` is a virtual module that does not exist in
            // Vitest's Node runtime. Redirect it to a test double so services
            // that read server secrets (ai.ts, supabase.ts) can be imported
            // under test. Only the unit project needs this: the integration
            // suite imports service functions whose only imports are types.
            "astro:env/server": fileURLToPath(new URL("./src/test/__mocks__/astro-env-server.ts", import.meta.url)),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          // `.ts` only: a `.tsx` spec under `src/test/` needs a DOM and belongs
          // to the `client` project, whose own glob picks it up.
          include: ["src/test/**/*.test.ts"],
          exclude: ["src/test/client/**"],
        },
      },
      {
        resolve: {
          alias: {
            "@": atAlias,
            "astro:env/server": fileURLToPath(new URL("./src/test/__mocks__/astro-env-server.ts", import.meta.url)),
          },
        },
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/test/client/**/*.test.{ts,tsx}"],
        },
      },
      {
        resolve: {
          alias: { "@": atAlias },
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["integration/**/*.test.ts"],
          globalSetup: ["./integration/globalSetup.ts"],
          // Every assertion is a network round-trip to a container, and each
          // file creates two real users through the auth API. The 5s default
          // fails on machine load rather than on a defect.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // Serial by design. Two reasons, both real: `supabase/config.toml`
          // caps sign-ins at 30 per 5 minutes per IP, and every file writes to
          // the same database. Parallel workers would buy no wall-clock here —
          // the suite is dominated by container round-trips — and would cost
          // determinism.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
