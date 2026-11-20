"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { InvestmentContext } from "@/lib/domain/investment-context";
import type { RecommendationState } from "@/lib/domain/recommendation";
import type { DomainPot } from "@/lib/domain/waterfall";
import { cn } from "@/lib/utils";
import { CoachEntryPanel } from "./coach-entry-panel";
import { FreeMoneyPanel } from "./free-money-panel";
import { PlanningEntryPicker } from "./planning-entry-picker";
import { PropertyVsEtfDialog } from "./property-vs-etf-dialog";
import { copyPropertyVsEtfLink } from "./property-vs-etf-link";
import {
  buildPropertyVsEtfHref,
  mergePropertyVsEtfQuery,
  type PropertyVsEtfQueryState,
} from "./property-vs-etf-query";
import {
  createPropertyVsEtfFormState,
  propertyVsEtfReducer,
  type PropertyVsEtfAction,
} from "./property-vs-etf-state";
import {
  buildPlanningHref,
  createFreeMoneyState,
  createRecommendationUiState,
  createSalaryState,
  freeMoneyReducer,
  parsePlanningEntry,
  parsePlanningLoanId,
  parsePlanningView,
  recommendationReducer,
  salaryReducer,
  type FreeMoneyAction,
  type LoanOption,
  type PlanningEntry,
  type PlanningView,
} from "./planning-state";
import { RecommendationPanel } from "./recommendation-panel";
import type { RecommendationLabels } from "./recommendation-text";
import { SalaryPanel } from "./salary-panel";
import { SavingsPanel } from "./savings-panel";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/components/ui/segmented";

interface PlanungWorkspaceProps {
  initialEntry?: PlanningEntry | null;
  initialView?: PlanningView;
  initialLoanId?: string | null;
  asOfDate: string;
  loanOptions: LoanOption[];
  baseSurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: DomainPot[];
  startMonth: string;
  coachContext: InvestmentContext;
  coachRefLabels: Record<string, string>;
  recommendationState?: RecommendationState;
  recommendationLabels?: RecommendationLabels;
  showDebug?: boolean;
  initialPropertyVsEtf?: PropertyVsEtfQueryState;
}

const GELD_TABS: Array<{ id: PlanningView; label: string }> = [
  { id: "empfehlung", label: "Wohin mit X €?" },
  { id: "sparrate", label: "Sparrate empfehlen" },
  { id: "vergleich", label: "Darlehen & ETF" },
];

export function PlanungWorkspace({
  initialEntry = null,
  initialView = "empfehlung",
  initialLoanId = null,
  asOfDate,
  loanOptions,
  baseSurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
  startMonth,
  coachContext,
  coachRefLabels,
  recommendationState,
  recommendationLabels,
  showDebug = false,
  initialPropertyVsEtf,
}: PlanungWorkspaceProps) {
  const searchParams = useSearchParams();
  const activeEntry =
    searchParams !== null
      ? parsePlanningEntry(searchParams?.get("frage"))
      : initialEntry;
  const urlView =
    searchParams !== null
      ? parsePlanningView(searchParams?.get("ansicht"))
      : initialView;
  const resolvedLoanId = parsePlanningLoanId(
    searchParams !== null ? searchParams?.get("kredit") : initialLoanId,
    loanOptions,
  );

  const [viewOverride, setViewOverride] = React.useState<PlanningView | null>(
    null,
  );
  const activeView = viewOverride ?? urlView;

  const navRef = React.useRef<HTMLElement | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const [freeMoneyState, freeMoneyDispatch] = React.useReducer(
    (s: ReturnType<typeof createFreeMoneyState>, a: FreeMoneyAction) =>
      freeMoneyReducer(s, a, loanOptions),
    undefined,
    () => createFreeMoneyState(loanOptions, asOfDate, resolvedLoanId),
  );

  const [salaryState, salaryDispatch] = React.useReducer(
    salaryReducer,
    startMonth,
    createSalaryState,
  );

  // Nur Speicher, keine Persistenz: überlebt Schließen/Öffnen des Dialogs.
  const [immoOpen, setImmoOpen] = React.useState(
    initialPropertyVsEtf?.open ?? false,
  );
  const [immoState, immoReducerDispatch] = React.useReducer(
    propertyVsEtfReducer,
    initialPropertyVsEtf,
    (initial) => initial?.state ?? createPropertyVsEtfFormState(),
  );
  const [immoOrigin, setImmoOrigin] = React.useState(
    initialPropertyVsEtf?.origin ?? null,
  );
  const immoDispatch = React.useCallback((action: PropertyVsEtfAction) => {
    if (action.type === "resetAll") setImmoOrigin(null);
    immoReducerDispatch(action);
  }, []);

  // URL ist nur ein Spiegel des Formularzustands (Einbahnstraße, kein History-Spam).
  const deferredImmo = React.useDeferredValue(immoState);
  React.useEffect(() => {
    const timer = window.setTimeout(
      () => {
        try {
          const current = window.location.search.replace(/^\?/, "");
          const next = mergePropertyVsEtfQuery(
            window.location.search,
            immoOpen,
            deferredImmo,
          );
          if (next === current) return;
          window.history.replaceState(
            window.history.state,
            "",
            buildPropertyVsEtfHref(window.location.pathname, next),
          );
        } catch {
          // Die URL ist nur Komfort (z. B. Safari-Drosselung): Fehler ignorieren.
        }
      },
      immoOpen ? 300 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [immoOpen, deferredImmo]);

  const handleCopyImmoLink = React.useCallback(async () => {
    const href = buildPropertyVsEtfHref(
      window.location.pathname,
      mergePropertyVsEtfQuery(window.location.search, true, immoState),
    );
    const url = `${window.location.origin}${href}`;
    return copyPropertyVsEtfLink(
      url,
      typeof navigator !== "undefined" ? navigator.clipboard : null,
    );
  }, [immoState]);

  const [recUiState, recUiDispatch] = React.useReducer(
    recommendationReducer,
    undefined,
    createRecommendationUiState,
  );

  const fallbackRecommendationState = React.useMemo<RecommendationState>(
    () =>
      recommendationState ?? {
        asOfDate,
        monthlyExpensesCents: null,
        monthlySurplusCents: baseSurplusCents,
        pots: pots.map((p) => ({
          id: p.id,
          name: p.name,
          priority: p.priority,
          purpose: null,
          currentCents: p.currentCents,
          targetCents: p.targetCents,
          targetDate: null,
          ruleType: p.ruleType,
          fixedMonthlyCents: p.fixedMonthlyCents,
          remainderPercentage: p.remainderPercentage,
          linkedContractId: null,
        })),
        loans: loanOptions.map((l) => ({
          id: l.id,
          balanceCents: l.defaults.loan.balanceCents,
          interestRateBps: l.defaults.loan.interestRateBps,
          monthlyRateCents: l.defaults.loan.monthlyRateCents,
          repaymentType: l.defaults.loan.repaymentType,
          specialRepaymentMaxYearlyCents: l.defaults.specialAllowance.capCents,
          specialRepaymentRule: l.defaults.specialAllowance.rule,
          specialRepaymentUsedThisYearCents: l.defaults.specialAllowance.usedCents,
          rateCorridor: l.defaults.rateCorridor,
          rateChangeScope: l.contract?.rateChangeScope ?? null,
          fixedInterestUntil: l.defaults.horizonEstimated
            ? null
            : l.defaults.horizonEndDate,
          futureLoanInterestRateBps: null,
        })),
      },
    [asOfDate, baseSurplusCents, loanOptions, pots, recommendationState],
  );

  const fallbackLabels = React.useMemo<RecommendationLabels>(() => {
    if (recommendationLabels) return recommendationLabels;
    const potNames: Record<string, string> = {};
    for (const p of pots) potNames[p.id] = p.name;
    const loanNames: Record<string, string> = {};
    for (const l of loanOptions) loanNames[l.id] = l.name;
    return { potNames, loanNames };
  }, [loanOptions, pots, recommendationLabels]);

  const handleNavigate = (entry: PlanningEntry | null) => {
    setViewOverride(null);
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

  const handleSelectView = (view: PlanningView) => {
    setViewOverride(view);
    window.history.replaceState(null, "", buildPlanningHref("geld", view));
  };

  const handleTabKeyDown = (
    idx: number,
    e: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") {
      nextIdx = (idx + 1) % GELD_TABS.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = (idx - 1 + GELD_TABS.length) % GELD_TABS.length;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const nextTab = GELD_TABS[nextIdx]!;
      handleSelectView(nextTab.id);
      tabRefs.current[nextIdx]?.focus();
    }
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
        onOpenPropertyVsEtf={() => setImmoOpen(true)}
      />

      <PropertyVsEtfDialog
        open={immoOpen}
        onOpenChange={setImmoOpen}
        state={immoState}
        dispatch={immoDispatch}
        origin={immoOrigin}
        onCopyLink={handleCopyImmoLink}
      />

      {activeEntry === "geld" ? (
        <div className="flex flex-col gap-5">
          <SegmentGroup>
          <div
            role="tablist"
            aria-label="Ansichten für freies Geld"
            className={cn(SEGMENT_TRACK, "self-start")}
          >
            {GELD_TABS.map((tab, idx) => {
              const selected = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[idx] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => handleSelectView(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(idx, e)}
                  className={cn(segmentItemClass(selected), "px-3 py-1.5")}
                >
                  {selected ? <SegmentPill /> : null}
                  <SegmentLabel>{tab.label}</SegmentLabel>
                </button>
              );
            })}
          </div>
          </SegmentGroup>

          {activeView === "empfehlung" ? (
            <RecommendationPanel
              uiState={recUiState}
              dispatch={recUiDispatch}
              recommendationState={fallbackRecommendationState}
              labels={fallbackLabels}
              refLabels={coachRefLabels}
              isDummy={isDummy}
              showDebug={showDebug}
            />
          ) : activeView === "sparrate" ? (
            <SavingsPanel
              uiState={recUiState}
              dispatch={recUiDispatch}
              recommendationState={fallbackRecommendationState}
              labels={fallbackLabels}
              refLabels={coachRefLabels}
              hasHouseholdData={hasHouseholdData}
              isDummy={isDummy}
              showDebug={showDebug}
            />
          ) : (
            <FreeMoneyPanel
              state={freeMoneyState}
              dispatch={freeMoneyDispatch}
              asOfDate={asOfDate}
              loanOptions={loanOptions}
            />
          )}
        </div>
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
        <CoachEntryPanel
          context={coachContext}
          refLabels={coachRefLabels}
          showDebug={showDebug}
        />
      ) : null}
    </div>
  );
}
