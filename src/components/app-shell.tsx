"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CoruscantLogo } from "@/components/coruscant-logo";
import { CommandMenu } from "@/components/command-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { SPRING_SNAPPY } from "@/components/ui/motion";
import {
  FINANZ_COCKPIT_LINK,
  NAV_ITEMS,
  isNavItemActive,
} from "@/components/shell-config";

const FOCUS_RING =
  "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_32%,transparent)]";

/** Feiner Lade-Hinweis am angeklickten Navigationspunkt (immer gerendert, nur die Deckkraft wechselt – kein Layout-Sprung). */
function NavPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? "true" : undefined}
      className="nav-pending-hint pointer-events-none absolute inset-x-2 bottom-0.5 h-[2px] overflow-hidden rounded-full opacity-0 transition-opacity duration-200 data-[pending=true]:opacity-100"
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
      <div className="ambient-backdrop" aria-hidden="true" />

      <header className="surface-glass sticky top-0 z-30 border-b border-[color-mix(in_srgb,var(--border)_80%,transparent)] print:static print:border-b print:bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <div className="flex h-full min-w-0 items-center gap-5 lg:gap-7">
            <Link
              href="/"
              aria-label="Coruscant – Startseite"
              className={cn(
                "group inline-flex shrink-0 items-center gap-2.5 rounded-lg text-sm font-semibold tracking-tight text-[var(--text-primary)]",
                FOCUS_RING,
              )}
            >
              <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_25%,var(--border))] bg-[linear-gradient(160deg,var(--accent-soft),transparent_70%)] shadow-[var(--shadow-xs),inset_0_1px_0_0_var(--hairline-highlight)] transition-transform duration-300 ease-out group-hover:rotate-[-8deg] motion-reduce:group-hover:rotate-0">
                <CoruscantLogo className="h-5 w-5 shrink-0 text-[var(--accent)]" />
              </span>
              <span className="hidden min-[400px]:inline">Coruscant</span>
              {devMode ? (
                <span
                  aria-label="Entwicklungsmodus"
                  className="rounded-md border border-[var(--amber)]/50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[var(--amber)] print:hidden"
                >
                  DEV
                </span>
              ) : null}
            </Link>

            <LayoutGroup id="main-nav">
              <nav
                aria-label="Hauptnavigation"
                className="hidden items-center gap-0.5 md:flex print:hidden"
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
                        "relative inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none",
                        FOCUS_RING,
                        isActive
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface-elevated)_70%,transparent)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      {isActive ? (
                        <motion.span
                          layoutId="main-nav-pill"
                          aria-hidden="true"
                          transition={SPRING_SNAPPY}
                          className="absolute inset-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm),inset_0_1px_0_0_var(--hairline-highlight)] dark:border-[var(--border-sub)]/70 dark:bg-[var(--surface-elevated)]/70"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "relative h-4 w-4 transition-colors",
                          isActive && "text-[var(--accent)]",
                        )}
                        aria-hidden="true"
                      />
                      <span className="relative">
                        <span className="sr-only lg:not-sr-only">{label}</span>
                      </span>
                      <NavPendingHint />
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
                    "group hidden items-center gap-1 rounded-md text-xs font-medium text-[var(--text-secondary)] transition-colors motion-reduce:transition-none hover:text-[var(--text-primary)] sm:inline-flex print:hidden",
                    FOCUS_RING,
                  )}
                >
                  <span>{FINANZ_COCKPIT_LINK.label}</span>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </a>
                <span
                  aria-hidden="true"
                  className="hidden h-5 w-px bg-[var(--border)] sm:block print:hidden"
                />
              </>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-28 sm:px-6 md:py-8 md:pb-12">
        {children}
      </main>

      <LayoutGroup id="mobile-nav">
        <nav
          aria-label="Mobile Navigation"
          className="surface-glass fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-2xl border border-[var(--border)] p-1 shadow-[var(--shadow-lg)] md:hidden print:hidden"
          style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
        >
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = isNavItemActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-medium transition-colors motion-reduce:transition-none",
                  FOCUS_RING,
                  isActive
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="mobile-nav-pill"
                    aria-hidden="true"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-xl bg-[var(--accent-soft)]"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "relative h-[18px] w-[18px]",
                    isActive && "text-[var(--accent)]",
                  )}
                  aria-hidden="true"
                />
                <span className="relative">
                  <span>{label}</span>
                </span>
                <NavPendingHint />
              </Link>
            );
          })}
        </nav>
      </LayoutGroup>
    </div>
  );
}
