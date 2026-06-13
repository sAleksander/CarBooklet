// Primary nav items shown in the sidebar. Intentionally excludes /cars —
// that route is accessed only via the car-switcher widget.
// Cross-ref: PROTECTED_ROUTES in src/middleware.ts must stay in sync.
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", labelKey: "nav.dashboard" },
  { href: "/entries", label: "Entries", labelKey: "nav.entries" },
  { href: "/ai-chat", label: "AI Chat", labelKey: "nav.aiChat" },
] as const;
