"use client";

import type { InvestmentContext } from "@/lib/domain/investment-context";
import { InvestmentCoachCard } from "./investment-coach-card";

interface CoachEntryPanelProps {
  context: InvestmentContext;
  refLabels: Record<string, string>;
}

export function CoachEntryPanel({ context, refLabels }: CoachEntryPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Investment-Coach</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Ordnet die Aufteilung deines Haushalts-Depots ein. Konkrete Empfehlungen
          („Wohin mit X €?“) kommen hier bald dazu.
        </p>
      </div>
      <InvestmentCoachCard context={context} refLabels={refLabels} />
    </div>
  );
}
