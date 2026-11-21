"use client";

import { formatDateTimeDE } from "@/domain/core/date-format";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { AllocationSettingsState } from "@/backend/db/queries/allocation-settings";
import type { CashflowItemRow } from "@/backend/db/queries/cashflow-items";
import type { PotRow } from "@/backend/db/queries/pots";
import type { RecentPotAllocationRow } from "@/backend/db/queries/pot-allocations";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import {
  calculateConsolidatedCashflow, type DomainCashflowItem, type VariableExpenseBasis,
} from "@/domain/allocation/cashflow";
import type { HouseholdSourceStatus } from "@/backend/integrations/household-dummy";
import { getTodayIsoDate } from "@/domain/core/date";
import { formatCentsDE } from "@/domain/core/money";
import {
  evaluatePotDeadlines, summarizeDeadlineRisks, type PotDeadlineEvaluation,
} from "@/domain/allocation/pot-deadline";
import { buildSurplusFlow } from "@/domain/allocation/surplus-flow";
import { applyPendingTransfers, type PotLinkOption } from "@/domain/allocation/pot-sync";
import {
  calculateWaterfallSuggestion, type PotRuleType, type WaterfallPlan,
} from "@/domain/allocation/waterfall";
import type { HouseholdSummary } from "@/validation/external";
import type { AllocationPrefill } from "./allocation-prefill";

export interface HouseholdWorkspaceData {
  household: HouseholdSummary | null;
  isDummy: boolean;
  sourceStatus: HouseholdSourceStatus;
  fetchedAt: string | null;
  bridgeConfigured: boolean;
}

export interface AllokationWorkspaceProps {
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

export function getPotRuleLabel(pot: PotRow): string {
  const ruleLabels: Record<PotRuleType, string> = {
    fill_to_target: "Bis Zielwert",
    fixed_monthly: `Fest: ${formatCentsDE(pot.fixedMonthlyCents ?? 0)} / Mon.`,
    percentage_of_remainder: `${pot.remainderPercentage ?? 0} % vom Rest`,
  };
  return ruleLabels[pot.ruleType];
}

export function formatJournalTimestamp(isoString: string): string {
  return formatDateTimeDE(isoString);
}

/** Zustand, Ableitungen und Aktionen von AllokationWorkspace. */
export function useAllokationWorkspace({
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

  return {
    actionError,
    activePrefill,
    allocateModalOpen,
    allocatedByPotId,
    breakdownOpen,
    busyId,
    confirmDeletePotId,
    consolidatedSummary,
    contractById,
    contracts,
    deadlineEvalByPotId,
    deadlineRisk,
    derivedContractItems,
    derivedPropertyItems,
    editingPot,
    effectivePots,
    excludedContractsCount,
    handleDeletePot,
    handleMovePot,
    handleSyncBridge,
    handleToggleIncludeContractItems,
    handleToggleIncludePropertyItems,
    handleVariableBasisChange,
    householdData,
    includeContractItems,
    includePropertyItems,
    initialPrefill,
    initialSettings,
    isSyncingBridge,
    linkOptions,
    linkStatusByPotId,
    manualItems,
    monthlyPlan,
    pendingTransferCentsByPotId,
    persistSettings,
    potModalOpen,
    pots,
    potsConfigInvalid,
    prefillInvalid,
    properties,
    propertyById,
    recentAllocations,
    router,
    setActionError,
    setActivePrefill,
    setAllocateModalOpen,
    setBreakdownOpen,
    setBusyId,
    setConfirmDeletePotId,
    setEditingPot,
    setIncludeContractItems,
    setIncludePropertyItems,
    setIsSyncingBridge,
    setPotModalOpen,
    setShowInvalidPrefillNotice,
    setTransferPlanNotice,
    setVariableBasis,
    showInvalidPrefillNotice,
    surplusFlow,
    totalRemainderPct,
    transferPlanNotice,
    variableBasis,
    variableLabel,
  };
}

export type AllokationWorkspaceState = ReturnType<typeof useAllokationWorkspace>;
