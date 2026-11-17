"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExternalLink,
  LayoutDashboard,
  FileSpreadsheet,
  FlaskConical,
  GitFork,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_ITEMS = [
  { href: "/", label: "Cockpit", Icon: LayoutDashboard },
  { href: "/vertraege", label: "Verträge", Icon: FileSpreadsheet },
  { href: "/allokation", label: "Allokation", Icon: GitFork },
  { href: "/planung", label: "Planung", Icon: FlaskConical },
  { href: "/dokumente", label: "Dokumente", Icon: Inbox },
] as const;

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
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--text-primary)] sm:gap-2.5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)]">
                C
              </span>
              <span>Coruscant</span>
            </Link>

            <nav
              aria-label="Hauptnavigation"
              className="hidden items-center gap-1 md:flex print:hidden"
            >
              {NAV_ITEMS.map(({ href, label, Icon }) => {
                const isActive =
                  href === "/"
                    ? pathname === "/"
                    : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {finanzCockpitUrl ? (
              <a
                href={finanzCockpitUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="finanz_cockpit in neuem Tab öffnen"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] sm:gap-1.5 sm:px-2.5 sm:text-xs print:hidden"
              >
                <span>finanz_cockpit</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
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
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                isActive
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
