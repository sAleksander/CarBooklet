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

    // Two projects, because the two suites have incompatible prerequisites.
    //
    // `unit` must stay runnable with Docker stopped — `.husky/pre-commit` runs
    // `npm test`, and a pre-commit hook that needs a database is a pre-commit
    // hook people start bypassing. `integration` needs a live local Supabase
    // and is opted into explicitly via `npm run test:integration`.
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
          include: ["src/test/**/*.test.ts"],
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
