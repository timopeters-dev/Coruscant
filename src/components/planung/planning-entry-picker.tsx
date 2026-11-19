"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Coins, Home, TrendingUp } from "lucide-react";
import { formatWholeEuroDE } from "@/components/charts/chart-scale";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { buildPlanningHref, type PlanningEntry } from "./planning-state";

interface PlanningEntryPickerProps {
  activeEntry: PlanningEntry | null;
  onNavigate: (entry: PlanningEntry | null) => void;
  loanCount: number;
  baseSurplusCents: number;
  hasHouseholdData: boolean;
  navRef?: React.RefObject<HTMLElement | null>;
}

function isPlainLeftClick(e: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}

export function PlanningEntryPicker({
  activeEntry,
  onNavigate,
  loanCount,
  baseSurplusCents,
  hasHouseholdData,
  navRef,
}: PlanningEntryPickerProps) {
  const headingId = React.useId();

  const handleInternalClick =
    (entry: PlanningEntry | null) =>
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
      onNavigate(entry);
    };

  if (activeEntry === null) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 id={headingId} className="text-xl font-semibold tracking-tight">
            Was willst du wissen?
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Reine Simulation – verändert keine gespeicherten Daten.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <Link
            href={buildPlanningHref("geld")}
            prefetch={false}
            onClick={handleInternalClick("geld")}
            className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <div className="flex flex-col gap-2">
              <Coins
                className="h-5 w-5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold tracking-tight">
                Freies Geld einsetzen
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Wohin mit X €? Notgroschen, Töpfe, Sondertilgung oder ETF
              </p>
            </div>
            <p className="text-xs font-medium tabular-nums text-[var(--text-secondary)]">
              {loanCount > 0
                ? `${loanCount} ${loanCount === 1 ? "Kredit" : "Kredite"} zum Vergleich`
                : "Kein Kredit hinterlegt"}
            </p>
          </Link>

          <Link
            href={buildPlanningHref("gehalt")}
            prefetch={false}
            onClick={handleInternalClick("gehalt")}
            className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <div className="flex flex-col gap-2">
              <TrendingUp
                className="h-5 w-5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold tracking-tight">
                Mehr Gehalt
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Wann sind meine Töpfe voll, wenn mehr übrig bleibt?
              </p>
            </div>
            <p className="text-xs font-medium tabular-nums text-[var(--text-secondary)]">
              {hasHouseholdData
                ? `Überschuss heute ${formatWholeEuroDE(baseSurplusCents)} / Monat`
                : "Keine Haushaltsdaten"}
            </p>
          </Link>

          <Link
            href="/planung/kaufrechner"
            className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <div className="flex flex-col gap-2">
              <Home
                className="h-5 w-5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold tracking-tight">
                Immobilie kaufen
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Gesamtkosten, Eigenkapital und Break-even durchrechnen.
              </p>
            </div>
            <div>
              <StatusBadge variant="modeled" />
            </div>
          </Link>
        </div>

        <p className="text-sm text-[var(--text-secondary)]">
          Oder: Depot einordnen lassen ·{" "}
          <Link
            href={buildPlanningHref("coach")}
            prefetch={false}
            onClick={handleInternalClick("coach")}
            className="font-medium text-[var(--text-primary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:text-[var(--accent)]"
          >
            Erklär mir das
          </Link>
        </p>
      </section>
    );
  }

  const segments: Array<{
    key: string;
    label: string;
    href: string;
    entry?: PlanningEntry | null;
    external?: boolean;
  }> = [
    { key: "geld", label: "Freies Geld", href: buildPlanningHref("geld"), entry: "geld" },
    { key: "gehalt", label: "Mehr Gehalt", href: buildPlanningHref("gehalt"), entry: "gehalt" },
    { key: "kauf", label: "Immobilie kaufen", href: "/planung/kaufrechner", external: true },
    { key: "coach", label: "Erklär mir das", href: buildPlanningHref("coach"), entry: "coach" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-base font-semibold tracking-tight">
          Was willst du wissen?
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Reine Simulation – verändert keine gespeicherten Daten.
        </p>
      </header>

      <nav
        ref={navRef}
        aria-label="Was willst du wissen?"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {segments.map((seg) => {
            const isActive = seg.entry === activeEntry;
            return (
              <Link
                key={seg.key}
                href={seg.href}
                prefetch={seg.entry !== undefined ? false : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={
                  seg.entry !== undefined
                    ? handleInternalClick(seg.entry)
                    : undefined
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
                )}
              >
                {seg.label}
                {seg.external ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </div>

        <Link
          href={buildPlanningHref(null)}
          prefetch={false}
          onClick={handleInternalClick(null)}
          className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
        >
          Alle Fragen
        </Link>
      </nav>
    </div>
  );
}
