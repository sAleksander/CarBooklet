declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    selectedCarId: string | null;
    lang: import("@/i18n/config").Locale;
    theme: import("@/lib/theme-preference").ThemePreference;
    /**
     * Cloudflare's per-request `ExecutionContext`, attached by
     * `@astrojs/cloudflare`. The only member the app uses is `waitUntil`, which
     * keeps work alive after the response completes or the client disconnects —
     * see `src/lib/after-response.ts`, the one module that touches this.
     *
     * Typed structurally rather than as the adapter's `Runtime` interface on
     * purpose. That interface declares `cfContext: ExecutionContext`, a global
     * from `@cloudflare/workers-types`, which this project does not install; the
     * name resolves to an error type, and under `strictTypeChecked` every use of
     * it then fails as an unsafe `any`. Naming the one method we call costs a
     * line and keeps the call site genuinely type-checked.
     *
     * Optional because it is genuinely absent outside a Worker: unit tests build
     * `locals` by hand, and nothing should have to fake an ExecutionContext to
     * exercise a route.
     *
     * Reaching for `locals.runtime.ctx` from an older tutorial will not work —
     * that property was removed in `@astrojs/cloudflare` v13 and throws.
     */
    cfContext?: { waitUntil(promise: Promise<unknown>): void };
  }
}
