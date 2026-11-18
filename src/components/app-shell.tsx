"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CoruscantLogo } from "@/components/coruscant-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  FINANZ_COCKPIT_LINK,
  NAV_ITEMS,
  isNavItemActive,
} from "@/components/shell-config";

const FOCUS_RING =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const FOCUS_OFFSET =
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]";

export function AppShell({
  children,
  finanzCockpitUrl,
}: {
  children: React.ReactNode;
  finanzCockpitUrl?: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-sm print:static print:border-b print:bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <div className="flex h-full min-w-0 items-center gap-6 lg:gap-8">
            <Link
              href="/"
              aria-label="Coruscant – Startseite"
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-[var(--text-primary)]",
                FOCUS_RING,
                FOCUS_OFFSET,
              )}
            >
              <CoruscantLogo className="h-6 w-6 shrink-0 text-[var(--accent)]" />
              <span className="hidden min-[400px]:inline">Coruscant</span>
            </Link>

            <nav
              aria-label="Hauptnavigation"
              className="hidden h-full items-stretch gap-0.5 md:flex print:hidden"
            >
              {NAV_ITEMS.map(({ href, label, Icon }) => {
                const isActive = isNavItemActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    title={label}
                    className={cn(
                      "relative inline-flex h-full items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors motion-reduce:transition-none after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors focus-visible:ring-inset",
                      FOCUS_RING,
                      isActive
                        ? "text-[var(--text-primary)] after:bg-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:after:bg-[var(--border-sub)]",
                    )}
                  >
                    <Icon
                      className={cn("h-4 w-4", isActive && "text-[var(--accent)]")}
                      aria-hidden="true"
                    />
                    <span className="sr-only lg:not-sr-only">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-3">
            {finanzCockpitUrl ? (
              <>
                <a
                  href={finanzCockpitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={FINANZ_COCKPIT_LINK.ariaLabel}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md text-xs font-medium text-[var(--text-secondary)] transition-colors motion-reduce:transition-none hover:text-[var(--text-primary)] hover:underline hover:decoration-[var(--border-sub)] hover:underline-offset-4 print:hidden",
                    FOCUS_RING,
                    FOCUS_OFFSET,
                  )}
                >
                  <span>{FINANZ_COCKPIT_LINK.label}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <span
                  aria-hidden="true"
                  className="h-5 w-px bg-[var(--border)] print:hidden"
                />
              </>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:py-8 md:pb-10">
        {children}
      </main>

      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-sm md:hidden print:hidden"
      >
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const isActive = isNavItemActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 rounded-md py-2 text-[11px] font-medium transition-colors motion-reduce:transition-none before:absolute before:inset-x-[28%] before:-top-px before:h-0.5 before:rounded-full before:bg-transparent focus-visible:ring-inset",
                FOCUS_RING,
                isActive
                  ? "text-[var(--text-primary)] before:bg-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              <Icon
                className={cn("h-[18px] w-[18px]", isActive && "text-[var(--accent)]")}
                aria-hidden="true"
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
