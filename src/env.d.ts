declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    selectedCarId: string | null;
    lang: import("@/i18n/config").Locale;
    theme: import("@/lib/theme-preference").ThemePreference;
  }
}
