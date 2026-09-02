import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nextProvider } from "react-i18next";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { createClientI18n } from "@/i18n/client";
import type { Car } from "@/types";
import type { Locale } from "@/i18n/config";
import type { ThemePreference } from "@/lib/theme-preference";

interface Props {
  pathname: string;
  userEmail: string;
  selectedCar?: Car;
  lang: Locale;
  theme: ThemePreference;
}

interface InnerProps {
  pathname: string;
  userEmail: string;
  selectedCar?: Car;
  lang: Locale;
  theme: ThemePreference;
}

function MobileSidebarContent({ pathname, userEmail, selectedCar, lang, theme }: InnerProps) {
  const { t } = useTranslation();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="text-white/80 hover:text-white">
          <Menu className="h-5 w-5" />
          <span className="sr-only">{t("sidebar.openNavigation")}</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-60 border-r border-sidebar-border bg-sidebar p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("sidebar.navigation")}</SheetTitle>
        </SheetHeader>

        {/* Car switcher */}
        <div className="border-b border-sidebar-border p-4">
          <SheetClose asChild>
            <a
              href="/cars"
              className="flex w-full items-center rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
            >
              {selectedCar ? (
                <span className="truncate text-sidebar-foreground">
                  {selectedCar.brand} {selectedCar.model}
                </span>
              ) : (
                <span className="text-sidebar-foreground/50">{t("sidebar.selectACar")}</span>
              )}
            </a>
          </SheetClose>
        </div>

        {/* Nav list */}
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <SheetClose asChild key={item.href}>
                <a
                  href={item.href}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  {t(item.labelKey)}
                </a>
              </SheetClose>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-4">
          <p className="mb-3 truncate text-xs text-sidebar-foreground/60">{userEmail}</p>

          {/* Language toggle */}
          <div className="mb-3 flex gap-1">
            <form method="POST" action="/api/lang/en">
              <button
                type="submit"
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  lang === "en"
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                )}
              >
                {t("sidebar.langEn")}
              </button>
            </form>
            <form method="POST" action="/api/lang/pl">
              <button
                type="submit"
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  lang === "pl"
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                )}
              >
                {t("sidebar.langPl")}
              </button>
            </form>
          </div>

          {/* Theme toggle. Byte-for-byte counterpart of AppSidebar.astro's. */}
          <div className="mb-3 flex gap-1">
            <form method="POST" action="/api/theme/light">
              <button
                type="submit"
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  theme === "light"
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                )}
              >
                {t("sidebar.themeLight")}
              </button>
            </form>
            <form method="POST" action="/api/theme/dark">
              <button
                type="submit"
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  theme === "dark"
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                )}
              >
                {t("sidebar.themeDark")}
              </button>
            </form>
          </div>

          <form method="POST" action="/api/auth/signout">
            <button
              type="submit"
              className="text-sm text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground"
            >
              {t("sidebar.signOut")}
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MobileSidebarTrigger({ pathname, userEmail, selectedCar, lang, theme }: Props) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <MobileSidebarContent
        pathname={pathname}
        userEmail={userEmail}
        selectedCar={selectedCar}
        lang={lang}
        theme={theme}
      />
    </I18nextProvider>
  );
}
