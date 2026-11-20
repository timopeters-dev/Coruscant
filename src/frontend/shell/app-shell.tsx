"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/frontend/ui/cn";
import { CoruscantLogo } from "./coruscant-logo";
import { BespinMark } from "./bespin-mark";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";
import { SPRING_SNAPPY } from "@/frontend/ui/motion";
import {
  FINANZ_COCKPIT_LINK,
  NAV_ITEMS,
  isNavItemActive,
} from "./shell-config";

const FOCUS_RING =
  "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]";

/** Feiner Lade-Hinweis am angeklickten Navigationspunkt (immer gerendert, nur die Deckkraft wechselt – kein Layout-Sprung). */
function NavPendingHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? "true" : undefined}
      className={cn(
        "nav-pending-hint pointer-events-none absolute h-[2px] overflow-hidden opacity-0 transition-opacity duration-200 data-[pending=true]:opacity-100",
        className,
      )}
    />
  );
}

export function AppShell({
  children,
  finanzCockpitUrl,
  devMode = false,
}: {
  children: React.ReactNode;
  finanzCockpitUrl?: string | null;
  devMode?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-sub)] bg-[var(--bg)] print:static">
        <div className="mx-auto flex h-14 max-w-6xl items-stretch justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-stretch gap-4 lg:gap-8">
            <Link
              href="/"
              aria-label="Coruscant – Startseite"
              className={cn(
                "inline-flex shrink-0 items-center gap-2 self-center rounded-md text-[var(--text-primary)]",
                FOCUS_RING,
              )}
            >
              <CoruscantLogo className="h-[22px] w-[22px] shrink-0" />
              <span className="hidden font-[family-name:var(--font-display)] text-lg font-semibold leading-none min-[400px]:inline">
                Coruscant
              </span>
              {devMode ? (
                <span
                  aria-label="Entwicklungsmodus"
                  className="rounded-sm border border-[var(--amber)] px-1 py-px text-3xs font-semibold text-[var(--amber)] print:hidden"
                >
                  Dev
                </span>
              ) : null}
            </Link>

            <LayoutGroup id="main-nav">
              <nav
                aria-label="Hauptnavigation"
                className="hidden items-stretch md:flex print:hidden"
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
                        "relative inline-flex items-center gap-2 px-3 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none",
                        FOCUS_RING,
                        isActive
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <Icon className="h-4 w-4 lg:hidden" aria-hidden="true" />
                      <span className="sr-only lg:not-sr-only">{label}</span>
                      {isActive ? (
                        <motion.span
                          layoutId="main-nav-rule"
                          aria-hidden="true"
                          transition={SPRING_SNAPPY}
                          className="absolute inset-x-3 -bottom-px h-[2px] bg-[var(--accent)]"
                        />
                      ) : null}
                      <NavPendingHint className="inset-x-3 -bottom-px" />
                    </Link>
                  );
                })}
              </nav>
            </LayoutGroup>
          </div>

          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-3">
            <CommandMenu finanzCockpitUrl={finanzCockpitUrl ?? null} />
            {finanzCockpitUrl ? (
              <>
                <a
                  href={finanzCockpitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={FINANZ_COCKPIT_LINK.ariaLabel}
                  className={cn(
                    "hidden items-center gap-1.5 rounded-md text-xs font-medium text-[var(--text-secondary)] transition-colors motion-reduce:transition-none hover:text-[var(--text-primary)] sm:inline-flex print:hidden",
                    FOCUS_RING,
                  )}
                >
                  <BespinMark className="h-4 w-4" />
                  <span>{FINANZ_COCKPIT_LINK.label}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <span
                  aria-hidden="true"
                  className="hidden h-5 w-px bg-[var(--border-sub)] sm:block print:hidden"
                />
              </>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-7 pb-28 sm:px-6 md:py-10 md:pb-14">
        {children}
      </main>

      <LayoutGroup id="mobile-nav">
        <nav
          aria-label="Mobile Navigation"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--border-sub)] bg-[var(--surface)] md:hidden print:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = isNavItemActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 text-2xs font-medium transition-colors motion-reduce:transition-none",
                  FOCUS_RING,
                  isActive
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="mobile-nav-rule"
                    aria-hidden="true"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-x-4 -top-px h-[2px] bg-[var(--accent)]"
                  />
                ) : null}
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                <span className="relative">
                  <span>{label}</span>
                </span>
                <NavPendingHint className="inset-x-4 -top-px" />
              </Link>
            );
          })}
        </nav>
      </LayoutGroup>
    </div>
  );
}
