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

interface Props {
  pathname: string;
  userEmail: string;
  selectedCar?: Car;
  lang: Locale;
}

interface InnerProps {
  pathname: string;
  userEmail: string;
  selectedCar?: Car;
  lang: Locale;
}

function MobileSidebarContent({ pathname, userEmail, selectedCar, lang }: InnerProps) {
  const { t } = useTranslation();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="text-white/80 hover:text-white">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-60 border-r border-white/10 bg-[var(--sidebar)] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>

        {/* Car switcher */}
        <div className="border-b border-[var(--sidebar-border)] p-4">
          <SheetClose asChild>
            <a
              href="/cars"
              className="flex w-full items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
            >
              {selectedCar ? (
                <span className="truncate text-[var(--sidebar-foreground)]">
                  {selectedCar.brand} {selectedCar.model}
                </span>
              ) : (
                <span className="text-[var(--sidebar-foreground)]/50">{t("sidebar.selectACar")}</span>
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
                      ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]"
                      : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]",
                  )}
                >
                  {t(item.labelKey)}
                </a>
              </SheetClose>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--sidebar-border)] p-4">
          <p className="mb-3 truncate text-xs text-[var(--sidebar-foreground)]/60">{userEmail}</p>

          {/* Language toggle */}
          <div className="mb-3 flex gap-1">
            <form method="POST" action="/api/lang/en">
              <button
                type="submit"
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  lang === "en"
                    ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]"
                    : "text-[var(--sidebar-foreground)]/50 hover:text-[var(--sidebar-foreground)]",
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
                    ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]"
                    : "text-[var(--sidebar-foreground)]/50 hover:text-[var(--sidebar-foreground)]",
                )}
              >
                {t("sidebar.langPl")}
              </button>
            </form>
          </div>

          <form method="POST" action="/api/auth/signout">
            <button
              type="submit"
              className="text-sm text-[var(--sidebar-foreground)]/70 transition-colors hover:text-[var(--sidebar-foreground)]"
            >
              {t("sidebar.signOut")}
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MobileSidebarTrigger({ pathname, userEmail, selectedCar, lang }: Props) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <MobileSidebarContent pathname={pathname} userEmail={userEmail} selectedCar={selectedCar} lang={lang} />
    </I18nextProvider>
  );
}
