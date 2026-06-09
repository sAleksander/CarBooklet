import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { Car } from "@/types";

interface Props {
  pathname: string;
  userEmail: string;
  selectedCar?: Car;
}

export function MobileSidebarTrigger({ pathname, userEmail, selectedCar }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setOpen(true);
          }}
          className="text-white/80 hover:text-white"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open navigation</span>
        </Button>

        <SheetContent side="left" className="w-60 border-r border-white/10 bg-[var(--sidebar)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>

          {/* Car switcher */}
          <div className="border-b border-[var(--sidebar-border)] p-4">
            <a
              href="/cars"
              onClick={() => {
                setOpen(false);
              }}
              className="flex w-full items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
            >
              {selectedCar ? (
                <span className="truncate text-[var(--sidebar-foreground)]">
                  {selectedCar.brand} {selectedCar.model}
                </span>
              ) : (
                <span className="text-[var(--sidebar-foreground)]/50">Select a car</span>
              )}
            </a>
          </div>

          {/* Nav list */}
          <nav className="flex-1 space-y-1 p-3">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]"
                      : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]",
                  )}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-t border-[var(--sidebar-border)] p-4">
            <p className="mb-3 truncate text-xs text-[var(--sidebar-foreground)]/60">{userEmail}</p>
            <form method="POST" action="/api/auth/signout">
              <button
                type="submit"
                className="text-sm text-[var(--sidebar-foreground)]/70 transition-colors hover:text-[var(--sidebar-foreground)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
