"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { InvestmentContext } from "@/lib/domain/investment-context";
import type { DomainPot } from "@/lib/domain/waterfall";
import { CoachEntryPanel } from "./coach-entry-panel";
import { FreeMoneyPanel } from "./free-money-panel";
import { PlanningEntryPicker } from "./planning-entry-picker";
import {
  buildPlanningHref,
  createFreeMoneyState,
  createSalaryState,
  freeMoneyReducer,
  parsePlanningEntry,
  salaryReducer,
  type FreeMoneyAction,
  type LoanOption,
  type PlanningEntry,
} from "./planning-state";
import { SalaryPanel } from "./salary-panel";

interface PlanungWorkspaceProps {
  initialEntry?: PlanningEntry | null;
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
  initialEntry = null,
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
  const searchParams = useSearchParams();
  const activeEntry =
    searchParams !== null
      ? parsePlanningEntry(searchParams?.get("frage"))
      : initialEntry;

  const navRef = React.useRef<HTMLElement | null>(null);

  const [freeMoneyState, freeMoneyDispatch] = React.useReducer(
    (s: ReturnType<typeof createFreeMoneyState>, a: FreeMoneyAction) =>
      freeMoneyReducer(s, a, loanOptions),
    undefined,
    () => createFreeMoneyState(loanOptions, asOfDate),
  );

  const [salaryState, salaryDispatch] = React.useReducer(
    salaryReducer,
    startMonth,
    createSalaryState,
  );

  const handleNavigate = (entry: PlanningEntry | null) => {
    window.history.pushState(null, "", buildPlanningHref(entry));
    requestAnimationFrame(() => {
      const el = navRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        el.scrollIntoView({ block: "nearest" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PlanningEntryPicker
        activeEntry={activeEntry}
        onNavigate={handleNavigate}
        loanCount={loanOptions.length}
        baseSurplusCents={baseSurplusCents}
        hasHouseholdData={hasHouseholdData}
        navRef={navRef}
      />

      {activeEntry === "geld" ? (
        <FreeMoneyPanel
          state={freeMoneyState}
          dispatch={freeMoneyDispatch}
          asOfDate={asOfDate}
          loanOptions={loanOptions}
        />
      ) : activeEntry === "gehalt" ? (
        <SalaryPanel
          state={salaryState}
          dispatch={salaryDispatch}
          baseSurplusCents={baseSurplusCents}
          hasHouseholdData={hasHouseholdData}
          isDummy={isDummy}
          pots={pots}
          startMonth={startMonth}
        />
      ) : activeEntry === "coach" ? (
        <CoachEntryPanel context={coachContext} refLabels={coachRefLabels} />
      ) : null}
    </div>
  );
}
