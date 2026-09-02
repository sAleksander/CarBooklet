// The theme preference rail's config triple, mirroring src/i18n/config.ts.
//
// Deliberately kept separate from src/lib/theme.ts: src/middleware.ts imports
// this on every request, and theme.ts pulls in `cva`. Splitting them keeps the
// middleware bundle free of the styling layer.

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

// "system" is a real stored state, not a third palette: it means "no cookie",
// which lets the client follow `prefers-color-scheme`.
export type ThemePreference = Theme | "system";

export const DEFAULT_THEME: ThemePreference = "system";

export function isTheme(value: string | undefined): value is Theme {
  return THEMES.includes(value as Theme);
}
