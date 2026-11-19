"use client";

import Link from "next/link";
import type { InvestmentContext } from "@/lib/domain/investment-context";
import { InvestmentCoachCard } from "./investment-coach-card";

interface CoachEntryPanelProps {
  context: InvestmentContext;
  refLabels: Record<string, string>;
  showDebug?: boolean;
}

export function CoachEntryPanel({
  context,
  refLabels,
  showDebug = false,
}: CoachEntryPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Erklär mir das</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Ordnet dein Haushalts-Depot ein und beantwortet Fragen. Konkrete
          Beträge findest du unter{" "}
          <Link
            href="/planung?frage=geld"
            className="font-medium text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--accent)]"
          >
            Freies Geld einsetzen
          </Link>
          .
        </p>
      </div>
      <InvestmentCoachCard
        context={context}
        refLabels={refLabels}
        showDebug={showDebug}
      />
    </div>
  );
}
