import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig.json `@/*` → `./src/*`.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `astro:env/server` is a virtual module that does not exist in Vitest's
      // Node runtime. Redirect it to a test double so services that read
      // server secrets (ai.ts, supabase.ts) can be imported under test.
      "astro:env/server": fileURLToPath(new URL("./src/test/__mocks__/astro-env-server.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // Phase 1 stands the runner up before any specs exist; don't fail the
    // bootstrap green state on an empty suite.
    passWithNoTests: true,
  },
});
