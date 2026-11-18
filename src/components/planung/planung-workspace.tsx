"use client";

import { CashflowChangeCard } from "./cashflow-change-card";
import {
  PrepaymentVsEtfCard,
  type LoanOption,
} from "./prepayment-vs-etf-card";
import type { InvestmentContext } from "@/lib/domain/investment-context";
import type { DomainPot } from "@/lib/domain/waterfall";
import { InvestmentCoachCard } from "./investment-coach-card";
import { PurchaseCalculatorCard } from "./purchase-calculator-card";

interface PlanungWorkspaceProps {
  asOfDate: string;
  loanOptions: LoanOption[];
  baseSurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: DomainPot[];
  startMonth: string;
  coachContext: InvestmentContext;
  coachRefLabels: Record<string, string>;
}

export function PlanungWorkspace({
  asOfDate,
  loanOptions,
  baseSurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
  startMonth,
  coachContext,
  coachRefLabels,
}: PlanungWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Szenario-Labor</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Reine Simulation – verändert keine gespeicherten Daten.
        </p>
      </header>
      <PrepaymentVsEtfCard asOfDate={asOfDate} loanOptions={loanOptions} />
      <CashflowChangeCard
        baseSurplusCents={baseSurplusCents}
        hasHouseholdData={hasHouseholdData}
        isDummy={isDummy}
        pots={pots}
        startMonth={startMonth}
      />
      <PurchaseCalculatorCard />
      <InvestmentCoachCard context={coachContext} refLabels={coachRefLabels} />
    </div>
  );
}
