"use client";

import { formatDateTimeDE, formatMonthDE } from "@/domain/core/date-format";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import type {
  AllocationSettingsState,
  CashflowItemRow,
  PotRow,
  RecentPotAllocationRow,
} from "@/backend/db/queries/allocation";
import type { FinancialContractRow, PropertyRow } from "@/backend/db/queries/contracts";
import {
  calculateConsolidatedCashflow,
  type DomainCashflowItem,
  type VariableExpenseBasis,
} from "@/domain/allocation/cashflow";
import type { HouseholdSourceStatus } from "@/backend/integrations/household-dummy";
import { getTodayIsoDate } from "@/domain/core/date";
import { formatCentsDE } from "@/domain/core/money";
import {
  evaluatePotDeadlines,
  summarizeDeadlineRisks,
  type PotDeadlineEvaluation,
} from "@/domain/allocation/pot-deadline";
import {
  buildPotProgressBar,
  buildSurplusFlow,
} from "@/domain/allocation/surplus-flow";
import { POT_DEADLINE_BADGE_META } from "./deadline-labels";
import { applyPendingTransfers, type PotLinkOption } from "@/domain/allocation/pot-sync";
import {
  calculateWaterfallSuggestion,
  type PotRuleType,
  type WaterfallPlan,
} from "@/domain/allocation/waterfall";
import type { HouseholdSummary } from "@/validation/external";
import { cn } from "@/frontend/ui/cn";
import { AllocateModal } from "./allocate-modal";
import type { AllocationPrefill } from "./allocation-prefill";
import { LegacyPlanItems } from "./legacy-plan-items";
import { PotModal } from "./pot-modal";
import { PotProgressBar } from "./pot-progress-bar";
import { SurplusFlowChart } from "./surplus-flow-chart";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";
import { InfoTip } from "@/frontend/ui/info-tip";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/frontend/ui/segmented";

interface HouseholdWorkspaceData {
  household: HouseholdSummary | null;
  isDummy: boolean;
  sourceStatus: HouseholdSourceStatus;
  fetchedAt: string | null;
  bridgeConfigured: boolean;
}

interface AllokationWorkspaceProps {
  manualItems: CashflowItemRow[];
  derivedContractItems: DomainCashflowItem[];
  derivedPropertyItems: DomainCashflowItem[];
  excludedContractsCount: number;
  pots: PotRow[];
  linkOptions: PotLinkOption[];
  pendingTransferCentsByPotId: Record<string, number>;
  linkStatusByPotId: Record<
    string,
    { status: "ok" | "missing" | "conflict" | "out_of_scope"; clampedNegative: boolean }
  >;
  recentAllocations: RecentPotAllocationRow[];
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  initialSettings: AllocationSettingsState;
  initialPrefill?: AllocationPrefill | null;
  prefillInvalid?: boolean;
  householdData: HouseholdWorkspaceData;
}

function getPotRuleLabel(pot: PotRow): string {
  const ruleLabels: Record<PotRuleType, string> = {
    fill_to_target: "Bis Zielwert",
    fixed_monthly: `Fest: ${formatCentsDE(pot.fixedMonthlyCents ?? 0)} / Mon.`,
    percentage_of_remainder: `${pot.remainderPercentage ?? 0} % vom Rest`,
  };
  return ruleLabels[pot.ruleType];
}

function formatJournalTimestamp(isoString: string): string {
  return formatDateTimeDE(isoString);
}

export function AllokationWorkspace({
  manualItems,
  derivedContractItems,
  derivedPropertyItems,
  excludedContractsCount,
  pots,
  linkOptions,
  pendingTransferCentsByPotId,
  linkStatusByPotId,
  recentAllocations,
  properties,
  contracts,
  initialSettings,
  initialPrefill = null,
  prefillInvalid = false,
  householdData,
}: AllokationWorkspaceProps) {
  const router = useRouter();

  const [variableBasis, setVariableBasis] =
    React.useState<VariableExpenseBasis>(initialSettings.variableBasis);
  const [includeContractItems, setIncludeContractItems] =
    React.useState<boolean>(initialSettings.includeContractItems);
  const [includePropertyItems, setIncludePropertyItems] =
    React.useState<boolean>(initialSettings.includePropertyItems);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [isSyncingBridge, setIsSyncingBridge] = React.useState(false);

  const [potModalOpen, setPotModalOpen] = React.useState(false);
  const [editingPot, setEditingPot] = React.useState<PotRow | null>(null);

  const [activePrefill, setActivePrefill] =
    React.useState<AllocationPrefill | null>(initialPrefill);
  const [allocateModalOpen, setAllocateModalOpen] = React.useState(
    Boolean(initialPrefill),
  );
  const [showInvalidPrefillNotice, setShowInvalidPrefillNotice] =
    React.useState(prefillInvalid);

  React.useEffect(() => {
    if (prefillInvalid && typeof window !== "undefined") {
      window.history.replaceState(null, "", "/allokation");
    }
  }, [prefillInvalid]);
  const [transferPlanNotice, setTransferPlanNotice] = React.useState<
    number | null
  >(null);

  const [confirmDeletePotId, setConfirmDeletePotId] = React.useState<
    string | null
  >(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const propertyById = React.useMemo(
    () => new Map(properties.map((p) => [p.id, p])),
    [properties],
  );
  const contractById = React.useMemo(
    () => new Map(contracts.map((c) => [c.id, c])),
    [contracts],
  );

  const totalRemainderPct = React.useMemo(() => {
    return pots.reduce((sum, pot) => {
      if (
        pot.ruleType === "percentage_of_remainder" &&
        pot.remainderPercentage !== null
      ) {
        return sum + pot.remainderPercentage;
      }
      return sum;
    }, 0);
  }, [pots]);

  const consolidatedSummary = React.useMemo(() => {
    return calculateConsolidatedCashflow({
      household: householdData.household,
      variableBasis,
      manualItems,
      contractItems: derivedContractItems,
      includeContractItems,
      propertyItems: derivedPropertyItems,
      includePropertyItems,
    });
  }, [
    householdData.household,
    variableBasis,
    manualItems,
    derivedContractItems,
    includeContractItems,
    derivedPropertyItems,
    includePropertyItems,
  ]);

  const effectivePots = React.useMemo(
    () =>
      applyPendingTransfers(
        pots,
        new Map<string, number>(Object.entries(pendingTransferCentsByPotId)),
      ),
    [pots, pendingTransferCentsByPotId],
  );

  const deadlineEvalByPotId = React.useMemo(() => {
    const evals = evaluatePotDeadlines({
      pots: effectivePots,
      monthlySurplusCents: consolidatedSummary.monthlySurplusCents,
      todayIsoDate: getTodayIsoDate(),
    });
    return new Map<string, PotDeadlineEvaluation>(
      evals.map((item) => [item.potId, item]),
    );
  }, [effectivePots, consolidatedSummary.monthlySurplusCents]);

  const deadlineRisk = React.useMemo(
    () => summarizeDeadlineRisks([...deadlineEvalByPotId.values()]),
    [deadlineEvalByPotId],
  );

  // Eine Quelle für „Vorschlag dieses Monats“ (Diagramm, Topf-Balken).
  const monthlyPlan = React.useMemo<WaterfallPlan | null>(() => {
    if (effectivePots.length === 0) return null;
    try {
      return calculateWaterfallSuggestion(
        effectivePots,
        Math.max(0, consolidatedSummary.monthlySurplusCents),
        { mode: "monthly" },
      );
    } catch {
      return null;
    }
  }, [effectivePots, consolidatedSummary.monthlySurplusCents]);

  const potsConfigInvalid = pots.length > 0 && monthlyPlan === null;

  const surplusFlow = React.useMemo(
    () =>
      buildSurplusFlow({
        summary: consolidatedSummary,
        isDummy: householdData.isDummy,
        plan: monthlyPlan,
      }),
    [consolidatedSummary, householdData.isDummy, monthlyPlan],
  );

  const allocatedByPotId = React.useMemo(
    () =>
      new Map<string, number>(
        (monthlyPlan?.suggestions ?? []).map((s) => [s.potId, s.allocatedCents]),
      ),
    [monthlyPlan],
  );

  const variableLabel =
    variableBasis === "budget"
      ? "Plan-Budget"
      : variableBasis === "avg_3m"
        ? "Ø 3M"
        : "Ø 6M";

  async function persistSettings(
    patch: Partial<AllocationSettingsState>,
    rollback: () => void,
  ) {
    setActionError(null);
    try {
      const response = await fetch("/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        rollback();
        setActionError(
          "Allokations-Einstellungen konnten nicht gespeichert werden.",
        );
      }
    } catch {
      rollback();
      setActionError(
        "Netzwerkfehler beim Speichern der Allokations-Einstellungen.",
      );
    }
  }

  function handleVariableBasisChange(nextBasis: VariableExpenseBasis) {
    const prevBasis = variableBasis;
    setVariableBasis(nextBasis);
    void persistSettings({ variableBasis: nextBasis }, () =>
      setVariableBasis(prevBasis),
    );
  }

  function handleToggleIncludeContractItems() {
    const prevValue = includeContractItems;
    const nextValue = !prevValue;
    setIncludeContractItems(nextValue);
    void persistSettings({ includeContractItems: nextValue }, () =>
      setIncludeContractItems(prevValue),
    );
  }

  function handleToggleIncludePropertyItems() {
    const prevValue = includePropertyItems;
    const nextValue = !prevValue;
    setIncludePropertyItems(nextValue);
    void persistSettings({ includePropertyItems: nextValue }, () =>
      setIncludePropertyItems(prevValue),
    );
  }

  async function handleSyncBridge() {
    setIsSyncingBridge(true);
    setActionError(null);
    try {
      const response = await fetch("/api/external/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        setActionError(
          body?.message ?? "Abgleich mit Bespin fehlgeschlagen.",
        );
        return;
      }
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler beim Abgleich mit Bespin.");
    } finally {
      setIsSyncingBridge(false);
    }
  }

  async function handleMovePot(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= pots.length) {
      return;
    }

    const reordered = [...pots];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);

    setBusyId(moved.id);
    setActionError(null);
    try {
      const response = await fetch("/api/pots/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedPotIds: reordered.map((p) => p.id),
        }),
      });
      if (!response.ok) {
        setActionError("Priorität konnte nicht neu sortiert werden.");
        return;
      }
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler beim Sortieren der Töpfe.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeletePot(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/pots/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setActionError("Topf konnte nicht gelöscht werden.");
        return;
      }
      setConfirmDeletePotId(null);
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler beim Löschen des Topfs.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="page-title">
            Cashflow &amp; Wasserfall
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Gemeinschaftskonto aus Bespin, Verträge und priorisierte
            Ziel-Töpfe.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEditingPot(null);
              setPotModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Topf
          </Button>
          <Button
            onClick={() => setAllocateModalOpen(true)}
            disabled={pots.length === 0}
            title={
              pots.length === 0
                ? "Lege zuerst mindestens einen Ziel-Topf an."
                : undefined
            }
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Geld verteilen
          </Button>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-4 py-2.5 text-xs text-[var(--rose)]">
          {actionError}
        </div>
      ) : null}

      {showInvalidPrefillNotice ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-2.5 text-xs text-[var(--text-primary)]">
          <span>Übernahme nicht möglich – Töpfe haben sich geändert.</span>
          <button
            type="button"
            onClick={() => setShowInvalidPrefillNotice(false)}
            className="font-medium underline underline-offset-2"
          >
            Schließen
          </button>
        </div>
      ) : null}

      {transferPlanNotice !== null ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          Für{" "}
          <span className="tabular-nums font-medium">{transferPlanNotice}</span>{" "}
          gekoppelte {transferPlanNotice === 1 ? "Topf" : "Töpfe"} bitte die
          Überweisung ausführen – der Stand aktualisiert sich beim nächsten
          Sync.
        </div>
      ) : null}

      {/* Hero-Übersicht (einheitliches 3-Konten-Modell) */}
      {householdData.household === null ? (
        <div className="space-y-4">
          <Card className="border-dashed border-[var(--border-sub)]">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Noch kein Gemeinschaftskonto abgeglichen
                  </p>
                  <StatusBadge variant="modeled" detail="Nicht abgeglichen" />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Markiere in Bespin ein Konto als Gemeinschaftskonto (
                  <code className="font-mono">scope = household</code>) und
                  starte einen Abgleich. Verträge, Objekte und Ziel-Töpfe
                  bleiben bereits nutzbar.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={isSyncingBridge || !householdData.bridgeConfigured}
                onClick={handleSyncBridge}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isSyncingBridge && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                Mit Bespin abgleichen
              </Button>
            </CardContent>
          </Card>

          <Card className="border-dashed border-[var(--border-sub)]">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Haushalts-Überschuss (3-Konten-Modell)
                </CardTitle>
                <StatusBadge variant="modeled" detail="Ohne Gemeinschaftskonto" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-secondary)]">
                  Monatliche Einnahmen
                </p>
                <p className="tabular-nums text-xl font-semibold text-[var(--emerald)]">
                  {formatCentsDE(consolidatedSummary.totalInflowCents)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-secondary)]">
                  Ausgaben (Verträge &amp; Objekte)
                </p>
                <p className="tabular-nums text-xl font-semibold text-[var(--rose)]">
                  {formatCentsDE(consolidatedSummary.totalOutflowCents)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-secondary)]">
                  Frei verteilbarer Überschuss / Monat
                </p>
                <p
                  className={cn(
                    "tabular-nums text-xl font-semibold",
                    consolidatedSummary.isDeficit
                      ? "text-[var(--rose)]"
                      : "text-[var(--emerald)]",
                  )}
                >
                  {formatCentsDE(consolidatedSummary.monthlySurplusCents, {
                    showPlusSign: !consolidatedSummary.isDeficit,
                  })}
                </p>
                {consolidatedSummary.isDeficit ? (
                  <p className="text-xs text-[var(--rose)]">
                    Unterdeckung im Haushalts-Cashflow
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-[var(--border)]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  Gemeinschaftskonto &amp; Haushalts-Überschuss
                </CardTitle>
                {householdData.isDummy ? (
                  <StatusBadge
                    variant="modeled"
                    label="Dev-Vorschau"
                    detail="Dummy-Daten"
                  />
                ) : (
                  <StatusBadge variant="calibrated" />
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <SegmentGroup>
                  <div
                    role="group"
                    aria-label="Basis für variable Alltagskosten"
                    className={SEGMENT_TRACK}
                  >
                    {(
                      [
                        { id: "budget", label: "Plan-Budget" },
                        { id: "avg_3m", label: "Ø 3 Monate" },
                        { id: "avg_6m", label: "Ø 6 Monate" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={variableBasis === option.id}
                        onClick={() => handleVariableBasisChange(option.id)}
                        className={segmentItemClass(variableBasis === option.id)}
                      >
                        {variableBasis === option.id ? <SegmentPill /> : null}
                        <SegmentLabel>{option.label}</SegmentLabel>
                      </button>
                    ))}
                  </div>
                </SegmentGroup>
                <InfoTip
                  id="variable-basis-info"
                  label="Basis für variable Alltagskosten"
                  align="end"
                  text="Womit die variablen Alltagskosten (Lebensmittel, Freizeit …) angesetzt werden: mit deinem geplanten Budget oder mit dem tatsächlichen Durchschnitt der letzten 3 bzw. 6 Monate. Der Durchschnitt glättet Ausreißer, das Budget zeigt den Soll-Zustand."
                />
              </div>
            </div>
            {householdData.isDummy ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Lokale Dev-Vorschau mit fiktiven Beispieldaten (kein Live-Haushalt
                synchronisiert).
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                Kontostand Gemeinschaftskonto
              </p>
              <p
                className={cn(
                  "tabular-nums text-xl font-semibold",
                  householdData.household.balanceCents < 0
                    ? "text-[var(--rose)]"
                    : "text-[var(--text-primary)]",
                )}
              >
                {formatCentsDE(householdData.household.balanceCents)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                Monatliche Einnahmen
              </p>
              <p className="tabular-nums text-xl font-semibold text-[var(--emerald)]">
                {formatCentsDE(consolidatedSummary.totalInflowCents)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                Ausgaben (Fixkosten &amp; Variable)
              </p>
              <p className="tabular-nums text-xl font-semibold text-[var(--rose)]">
                {formatCentsDE(consolidatedSummary.totalOutflowCents)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                Frei verteilbarer Überschuss / Monat
              </p>
              <p
                className={cn(
                  "tabular-nums text-xl font-semibold",
                  consolidatedSummary.isDeficit
                    ? "text-[var(--rose)]"
                    : "text-[var(--emerald)]",
                )}
              >
                {formatCentsDE(consolidatedSummary.monthlySurplusCents, {
                  showPlusSign: !consolidatedSummary.isDeficit,
                })}
              </p>
              {consolidatedSummary.isDeficit ? (
                <p className="text-xs text-[var(--rose)]">
                  Unterdeckung im Haushalts-Cashflow
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <LegacyPlanItems
        items={manualItems}
        summary={consolidatedSummary}
        onChanged={() => router.refresh()}
      />

      <SurplusFlowChart
        flow={surplusFlow}
        plan={monthlyPlan}
        isDummy={householdData.isDummy}
        hasHouseholdData={consolidatedSummary.hasHouseholdData}
        variableLabel={variableLabel}
        deadlineRisk={deadlineRisk}
        potsConfigInvalid={potsConfigInvalid}
        onCreatePot={() => {
          setEditingPot(null);
          setPotModalOpen(true);
        }}
      />

      {/* Sektion: Gemeinschaftskonto-Basis (falls Snapshot oder Dev-Vorschau vorhanden) */}
      {householdData.household ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                Gemeinschaftskonto-Basis
              </h2>
              {householdData.isDummy ? (
                <StatusBadge
                  variant="modeled"
                  label="Dev-Vorschau"
                  detail="Dummy-Daten"
                />
              ) : (
                <StatusBadge variant="calibrated" />
              )}
            </div>
            {householdData.bridgeConfigured ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={isSyncingBridge}
                onClick={handleSyncBridge}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isSyncingBridge && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                {isSyncingBridge ? "Gleiche ab …" : "Jetzt abgleichen"}
              </Button>
            ) : null}
          </div>

          {householdData.household.categoriesBreakdown.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] ">
              <button
                type="button"
                onClick={() => setBreakdownOpen((prev) => !prev)}
                aria-expanded={breakdownOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>
                  Aufschlüsselung variabler Kategorien (
                  <span className="tabular-nums">
                    {householdData.household.categoriesBreakdown.length}
                  </span>
                  )
                </span>
                <CollapseChevron open={breakdownOpen} />
              </button>

              <Collapse open={breakdownOpen}>
                <div className="overflow-x-auto border-t border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)]/60 text-left text-[var(--text-secondary)]">
                        <th className="px-4 py-2 font-medium">Kategorie</th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "budget" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Plan-Budget
                        </th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "avg_3m" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Ø 3 Monate
                        </th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "avg_6m" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Ø 6 Monate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {householdData.household.categoriesBreakdown.map(
                        (cat) => (
                          <tr key={cat.categoryId}>
                            <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                {cat.categoryName}
                              </span>
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "budget"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.budgetCents)}
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "avg_3m"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.avg3MCents)}
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "avg_6m"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.avg6MCents)}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </Collapse>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Sektion: Verträge & Objekte im Überschuss */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              Verträge &amp; Objekte im Überschuss
            </h2>
            <StatusBadge variant="modeled" />
            <InfoTip
              id="surplus-contracts-info"
              label="Verträge & Objekte im Überschuss"
              text="Hier kannst du Vertragsraten und Objekt-Cashflows aus Coruscant zusätzlich in den Haushalts-Überschuss einrechnen. Das ist modelliert: Was bereits über das Gemeinschaftskonto erfasst ist, sollte nicht ein zweites Mal gezählt werden."
            />
          </div>
          <span className="text-xs text-[var(--text-secondary)]">
            <span className="tabular-nums">{derivedContractItems.length}</span>{" "}
            Verträge
          </span>
        </div>

        {/* Verknüpfte Coruscant-Vertragsraten (Live-Sync, schreibgeschützt) */}
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="section-label text-[var(--text-secondary)]">
                Verknüpfte Coruscant-Vertragsraten
              </h3>
              <Badge variant="default">Live-Sync</Badge>
              <InfoTip
                id="contract-rates-info"
                label="Verknüpfte Coruscant-Vertragsraten"
                text="Monatliche Raten deiner aktiven Haushalts-Verträge, direkt aus der Vertragsliste gelesen (schreibgeschützt). Änderungen nimmst du unter Verträge vor; hier erscheinen sie automatisch."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={includeContractItems}
                  onChange={handleToggleIncludeContractItems}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
                />
                Zusätzlich vom Haushalts-Überschuss abziehen
              </label>
              <InfoTip
                id="contract-rates-toggle-info"
                label="Zusätzlich vom Haushalts-Überschuss abziehen"
                align="end"
                text="Nur aktivieren, wenn diese Raten nicht schon als Fixkosten über das Gemeinschaftskonto laufen – sonst würden sie doppelt abgezogen und der Überschuss wirkt kleiner, als er ist."
              />
              <Link
                href="/vertraege"
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Verträge verwalten
              </Link>
            </div>
          </div>
          <p className="text-2xs text-[var(--text-secondary)]">
            {includeContractItems
              ? "Aktiviert: Diese Vertragsraten werden zusätzlich zu den Gemeinschaftskonto-Fixkosten abgezogen."
              : "Standardmäßig deaktiviert, um Doppelzählungen mit bereits über das Gemeinschaftskonto erkannten Fixkosten zu vermeiden."}
          </p>

          {derivedContractItems.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Keine aktiven Haushalts-Verträge mit monatlicher Rate vorhanden.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {derivedContractItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Landmark
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {item.name}
                    </span>
                  </div>
                  <span className="tabular-nums shrink-0 font-semibold text-[var(--rose)]">
                    −{formatCentsDE(item.amountCents)} / Mon.
                  </span>
                </div>
              ))}
            </div>
          )}

          {excludedContractsCount > 0 ? (
            <p className="text-2xs text-[var(--text-secondary)]">
              Hinweis:{" "}
              <span className="tabular-nums">{excludedContractsCount}</span>{" "}
              pausierte, geschlossene oder ratenlose Verträge fließen nicht in
              den Haushalts-Cashflow ein.
            </p>
          ) : null}
        </div>

        {derivedPropertyItems.length > 0 ? (
          <div className="space-y-2.5 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="section-label text-[var(--text-secondary)]">
                  Mieten &amp; Objektkosten (Modelliert)
                </h3>
                <Badge variant="outline">Objekt</Badge>
                <InfoTip
                  id="property-items-info"
                  label="Mieten & Objektkosten"
                  text="Aus deinen vermieteten Objekten abgeleitet: Kaltmiete als Zufluss, nicht umlagefähige Kosten und aktive verknüpfte Kreditraten als Abfluss. Modelliert – die Werte stammen aus den Objektdaten, nicht aus Kontobewegungen."
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={includePropertyItems}
                    onChange={handleToggleIncludePropertyItems}
                    className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
                  />
                  In Haushalts-Überschuss einrechnen
                </label>
                <InfoTip
                  id="property-items-toggle-info"
                  label="In Haushalts-Überschuss einrechnen"
                  align="end"
                  text="Rechnet die Objekt-Cashflows in den monatlichen Überschuss ein. Deaktivieren, wenn Miete oder Rate bereits über das Gemeinschaftskonto erfasst sind."
                />
                <Link
                  href="/vertraege?tab=portfolio"
                  className="text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Portfolio ansehen
                </Link>
              </div>
            </div>
            <p className="text-2xs text-[var(--text-secondary)]">
              Abgeleitet aus vermieteten Objekten inkl. verknüpfter
              Haushalts-Kreditraten (ohne Doppelzählung bei aktiven
              Vertragsraten). Falls Miete oder Rate bereits im Gemeinschaftskonto
              erfasst sind, bitte entsprechend deaktivieren.
            </p>
            <div className="divide-y divide-[var(--border)]">
              {derivedPropertyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {item.name}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "tabular-nums shrink-0 font-semibold",
                      item.direction === "inflow"
                        ? "text-[var(--emerald)]"
                        : "text-[var(--rose)]",
                    )}
                  >
                    {item.direction === "inflow" ? "+" : "−"}
                    {formatCentsDE(item.amountCents)} / Mon.
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Sektion 2: Priorisierte Ziel-Töpfe */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            Priorisierte Ziel-Töpfe
          </h2>
          <span className="text-xs text-[var(--text-secondary)]">
            Restverteilung:{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {totalRemainderPct} %
            </span>{" "}
            von 100 % vergeben
          </span>
        </div>

        {pots.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-between gap-3 py-8 text-center sm:flex-row sm:text-left">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Noch keine Ziel-Töpfe angelegt
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Lege priorisierte Töpfe für Rücklagen, Sparziele oder
                  Sondertilgungen an.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingPot(null);
                  setPotModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Ersten Topf anlegen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pots.map((pot, index) => {
              const linkedProperty = pot.linkedPropertyId
                ? propertyById.get(pot.linkedPropertyId)
                : undefined;
              const linkedContract = pot.linkedContractId
                ? contractById.get(pot.linkedContractId)
                : undefined;
              const isConfirming = confirmDeletePotId === pot.id;
              const isLinked = pot.externalLinkKind !== null;
              const linkOption = isLinked
                ? linkOptions.find(
                    (o) =>
                      o.kind === pot.externalLinkKind &&
                      o.ref === pot.externalLinkRef,
                  )
                : undefined;
              const linkStatus = linkStatusByPotId[pot.id];
              const isLinkOutOfScope =
                isLinked && linkStatus?.status === "out_of_scope";
              const isLinkMissing =
                isLinked &&
                linkStatus?.status !== "ok" &&
                linkStatus?.status !== "conflict" &&
                linkStatus?.status !== "out_of_scope";
              const isLinkConflict = isLinked && linkStatus?.status === "conflict";
              const isLinkStale =
                isLinkMissing || isLinkConflict || isLinkOutOfScope;

              const hasTarget = pot.targetCents !== null && pot.targetCents > 0;
              const progressPct = hasTarget
                ? Math.min(
                    100,
                    Number(
                      (BigInt(pot.currentCents) * 100n) /
                        BigInt(pot.targetCents!),
                    ),
                  )
                : null;
              const targetReached =
                pot.targetCents !== null && pot.currentCents >= pot.targetCents;

              return (
                <Card
                  key={pot.id}
                  className={cn(
                    !isLinked && "border-dashed border-[var(--border-sub)]",
                  )}
                >
                  <CardContent className="space-y-3 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="figure w-5 shrink-0 text-lg leading-6 text-[var(--text-muted)]"
                            aria-label={`Priorität ${pot.priority}`}
                          >
                            {pot.priority}
                          </span>
                          <span className="truncate text-base font-semibold text-[var(--text-primary)]">
                            {pot.name}
                          </span>
                          <Badge variant="secondary" className="tabular-nums">
                            {getPotRuleLabel(pot)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!isLinked ? (
                            <StatusBadge variant="modeled" />
                          ) : isLinkConflict ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Verknüpfung überschneidet sich"
                              detail="Konto und Position gleichzeitig gekoppelt"
                            />
                          ) : isLinkOutOfScope ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Außerhalb des Haushalts"
                              detail="zählt nicht"
                            />
                          ) : isLinkStale ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Verknüpfung nicht gefunden"
                              detail={
                                pot.externalSyncedAt
                                  ? `Stand vom ${formatJournalTimestamp(pot.externalSyncedAt)}`
                                  : "Noch kein Abgleich"
                              }
                            />
                          ) : (
                            <StatusBadge
                              variant="calibrated"
                              detail={linkOption?.label}
                            />
                          )}
                          {isLinked && !isLinkStale && linkStatus?.clampedNegative ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Konto im Minus"
                              detail="Stand auf 0,00 € begrenzt"
                            />
                          ) : null}
                          {isLinked && !isLinkStale && pot.externalSyncedAt ? (
                            <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                              Stand vom{" "}
                              {formatJournalTimestamp(pot.externalSyncedAt)}
                            </span>
                          ) : null}
                        </div>

                        {linkedProperty || linkedContract ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                            {linkedProperty ? (
                              <span className="inline-flex items-center gap-1">
                                <Building2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {linkedProperty.name}
                              </span>
                            ) : null}
                            {linkedContract ? (
                              <span className="inline-flex items-center gap-1">
                                <Landmark
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {linkedContract.name}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                        <div className="text-right">
                          <div className="tabular-nums text-base font-semibold text-[var(--text-primary)]">
                            {formatCentsDE(pot.currentCents)}
                            {pot.targetCents !== null ? (
                              <span className="text-xs font-normal text-[var(--text-secondary)]">
                                {" "}
                                / {formatCentsDE(pot.targetCents)}
                              </span>
                            ) : null}
                          </div>
                          {progressPct !== null ? (
                            <div
                              className={cn(
                                "tabular-nums text-xs font-medium",
                                targetReached
                                  ? "text-[var(--emerald)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {progressPct} % erreicht
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} nach oben verschieben`}
                            disabled={index === 0 || busyId !== null}
                            onClick={() => handleMovePot(index, -1)}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} nach unten verschieben`}
                            disabled={
                              index === pots.length - 1 || busyId !== null
                            }
                            onClick={() => handleMovePot(index, 1)}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} bearbeiten`}
                            disabled={busyId !== null}
                            onClick={() => {
                              setEditingPot(pot);
                              setPotModalOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busyId !== null}
                                className="border-[var(--rose)]/40 text-[var(--rose)]"
                                onClick={() => handleDeletePot(pot.id)}
                              >
                                Bestätigen
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId !== null}
                                onClick={() => setConfirmDeletePotId(null)}
                              >
                                Abbruch
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${pot.name} löschen`}
                              disabled={busyId !== null}
                              onClick={() => setConfirmDeletePotId(pot.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <PotProgressBar
                      bar={buildPotProgressBar({
                        currentCents: pot.currentCents,
                        pendingCents: pendingTransferCentsByPotId[pot.id] ?? 0,
                        allocatedCents: allocatedByPotId.get(pot.id) ?? 0,
                        targetCents: pot.targetCents,
                      })}
                      deadlineStatus={deadlineEvalByPotId.get(pot.id)?.status}
                    />

                    {(() => {
                      const deadlineEval = deadlineEvalByPotId.get(pot.id);
                      if (!deadlineEval) {
                        return null;
                      }
                      const badge = POT_DEADLINE_BADGE_META[deadlineEval.status];
                      const formatYm = formatMonthDE;

                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-secondary)]">
                            <StatusBadge variant="modeled" />
                            <span className="tabular-nums font-medium text-[var(--text-primary)]">
                              Termin {formatYm(deadlineEval.targetMonth)}
                            </span>
                            {deadlineEval.status !== "reached" ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {deadlineEval.requiredIsOneTime
                                    ? `Soll: ${formatCentsDE(deadlineEval.requiredMonthlyCents)} einmalig`
                                    : `Soll ${formatCentsDE(deadlineEval.requiredMonthlyCents)}/Monat`}
                                </span>
                                {deadlineEval.plannedMonthlyCents !== null ? (
                                  <>
                                    <span>·</span>
                                    <span className="tabular-nums">
                                      Ist Ø{" "}
                                      {formatCentsDE(
                                        deadlineEval.plannedMonthlyCents,
                                      )}
                                      /Monat
                                    </span>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            {deadlineEval.status === "at_risk" ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums text-[var(--rose)]">
                                  Fehlbetrag zum Termin{" "}
                                  {formatCentsDE(
                                    deadlineEval.shortfallAtDeadlineCents,
                                  )}
                                </span>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {deadlineEval.expectedReachMonth
                                    ? `voraussichtlich erreicht ${formatYm(deadlineEval.expectedReachMonth)}`
                                    : "nicht innerhalb von 40 Jahren"}
                                </span>
                              </>
                            ) : null}
                            {deadlineEval.status === "overdue" &&
                            deadlineEval.shortfallNowCents > 0 ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums text-[var(--rose)]">
                                  Fehlbetrag{" "}
                                  {formatCentsDE(deadlineEval.shortfallNowCents)}
                                </span>
                              </>
                            ) : null}
                            {pot.externalLinkKind === "position" ? (
                              <>
                                <span>·</span>
                                <span>ohne Kursentwicklung</span>
                              </>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium",
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Sektion 3: Letzte Verteilungen (Journal) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          Letzte Verteilungen
        </h2>

        {recentAllocations.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-xs text-[var(--text-secondary)]">
              Noch keine Wasserfall-Verteilungen verbucht.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-[var(--border)] py-1">
              {recentAllocations.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">
                        {entry.potName}
                      </span>
                      <Badge variant="secondary">{entry.sourceLabel}</Badge>
                    </div>
                    <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                      {formatJournalTimestamp(entry.allocatedAt)}
                    </p>
                  </div>
                  <span className="tabular-nums font-semibold text-[var(--emerald)]">
                    {formatCentsDE(entry.amountCents, { showPlusSign: true })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Modals */}
      <PotModal
        open={potModalOpen}
        onOpenChange={setPotModalOpen}
        initialPot={editingPot}
        existingPots={pots}
        linkOptions={linkOptions}
        properties={properties}
        contracts={contracts}
        onSaved={() => router.refresh()}
      />

      <AllocateModal
        open={allocateModalOpen}
        onOpenChange={(nextOpen) => {
          setAllocateModalOpen(nextOpen);
          if (!nextOpen && activePrefill) {
            setActivePrefill(null);
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", "/allokation");
            }
          }
        }}
        pots={pots}
        pendingTransferCentsByPotId={pendingTransferCentsByPotId}
        monthlySurplusCents={consolidatedSummary.monthlySurplusCents}
        prefill={activePrefill}
        onAllocated={({ transferPlanCount }) => {
          setTransferPlanNotice(transferPlanCount > 0 ? transferPlanCount : null);
          setActivePrefill(null);
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/allokation");
          }
          router.refresh();
        }}
      />
    </div>
  );
}
