"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronUp,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CashflowItemRow,
  PotRow,
  RecentPotAllocationRow,
} from "@/db/queries/allocation";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import {
  calculateConsolidatedCashflow,
  type CashflowFrequency,
  type DomainCashflowItem,
  normalizeItemToMonthlyCents,
  type VariableExpenseBasis,
} from "@/lib/domain/cashflow";
import type { HouseholdSourceStatus } from "@/lib/integrations/household-dummy";
import { formatCentsDE } from "@/lib/domain/money";
import type { PotRuleType } from "@/lib/domain/waterfall";
import type {
  AllocationSettings,
  HouseholdSummary,
} from "@/lib/validation/external";
import { cn } from "@/lib/utils";
import { AllocateModal } from "./allocate-modal";
import { CashflowItemModal } from "./cashflow-item-modal";
import type { PotLinkOption } from "@/lib/domain/pot-sync";
import { PotModal } from "./pot-modal";

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
  excludedContractsCount: number;
  pots: PotRow[];
  linkOptions: PotLinkOption[];
  pendingTransferCentsByPotId: Record<string, number>;
  linkStatusByPotId: Record<
    string,
    { status: "ok" | "missing" | "conflict"; clampedNegative: boolean }
  >;
  recentAllocations: RecentPotAllocationRow[];
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  initialSettings: AllocationSettings;
  householdData: HouseholdWorkspaceData;
}

const FREQUENCY_LABELS: Record<CashflowFrequency, string> = {
  monthly: "monatlich",
  quarterly: "quartalsweise",
  yearly: "jährlich",
};

function getPotRuleLabel(pot: PotRow): string {
  const ruleLabels: Record<PotRuleType, string> = {
    fill_to_target: "Bis Zielwert",
    fixed_monthly: `Fest: ${formatCentsDE(pot.fixedMonthlyCents ?? 0)} / Mon.`,
    percentage_of_remainder: `${pot.remainderPercentage ?? 0} % vom Rest`,
  };
  return ruleLabels[pot.ruleType];
}

function formatJournalTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AllokationWorkspace({
  manualItems,
  derivedContractItems,
  excludedContractsCount,
  pots,
  linkOptions,
  pendingTransferCentsByPotId,
  linkStatusByPotId,
  recentAllocations,
  properties,
  contracts,
  initialSettings,
  householdData,
}: AllokationWorkspaceProps) {
  const router = useRouter();

  const [variableBasis, setVariableBasis] =
    React.useState<VariableExpenseBasis>(initialSettings.variableBasis);
  const [includeContractItems, setIncludeContractItems] =
    React.useState<boolean>(initialSettings.includeContractItems);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [isSyncingBridge, setIsSyncingBridge] = React.useState(false);

  const [cashflowModalOpen, setCashflowModalOpen] = React.useState(false);
  const [editingCashflowItem, setEditingCashflowItem] =
    React.useState<CashflowItemRow | null>(null);

  const [potModalOpen, setPotModalOpen] = React.useState(false);
  const [editingPot, setEditingPot] = React.useState<PotRow | null>(null);

  const [allocateModalOpen, setAllocateModalOpen] = React.useState(false);
  const [transferPlanNotice, setTransferPlanNotice] = React.useState<
    number | null
  >(null);

  const [confirmDeleteCashflowId, setConfirmDeleteCashflowId] = React.useState<
    string | null
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
    });
  }, [
    householdData.household,
    variableBasis,
    manualItems,
    derivedContractItems,
    includeContractItems,
  ]);

  async function persistSettings(
    patch: Partial<AllocationSettings>,
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
          body?.message ?? "finanz_cockpit-Synchronisation fehlgeschlagen.",
        );
        return;
      }
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler bei der finanz_cockpit-Synchronisation.");
    } finally {
      setIsSyncingBridge(false);
    }
  }

  async function handleToggleCashflowActive(item: CashflowItemRow) {
    setBusyId(item.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/cashflow-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      if (!response.ok) {
        setActionError("Status der Position konnte nicht geändert werden.");
        return;
      }
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler beim Aktualisieren der Position.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteCashflowItem(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/cashflow-items/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setActionError("Position konnte nicht gelöscht werden.");
        return;
      }
      setConfirmDeleteCashflowId(null);
      router.refresh();
    } catch {
      setActionError("Netzwerkfehler beim Löschen der Position.");
    } finally {
      setBusyId(null);
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
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Cashflow &amp; Wasserfall
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Gemeinschaftskonto-Basis (finanz_cockpit), optionale Plan-Posten und
            priorisierte Ziel-Töpfe.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEditingCashflowItem(null);
              setCashflowModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Plan-Posten
          </Button>
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
                    Noch kein Gemeinschaftskonto synchronisiert
                  </p>
                  <StatusBadge variant="modeled" detail="Kein Sync" />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Markiere in <code className="font-mono">finanz_cockpit</code>{" "}
                  ein Konto als Gemeinschaftskonto (
                  <code className="font-mono">scope = household</code>) und
                  starte einen Sync. Optionale Plan-Posten, Verträge und
                  Ziel-Töpfe bleiben bereits vollständig nutzbar.
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
                finanz_cockpit synchronisieren
              </Button>
            </CardContent>
          </Card>

          <Card className="border-dashed border-[var(--border-sub)]">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Haushalts-Überschuss (3-Konten-Modell)
                </CardTitle>
                <StatusBadge variant="modeled" detail="Nur Plan-Posten" />
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
                  Ausgaben (Plan-Posten &amp; Verträge)
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

              <div
                role="group"
                aria-label="Basis für variable Alltagskosten"
                className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5"
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
                    onClick={() => handleVariableBasisChange(option.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      variableBasis === option.id
                        ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
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
                Ausgaben (Fixkosten, Variable &amp; Plan-Posten)
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
                Sync
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Wiederkehrende Einnahmen (Gehälter)
                </p>
                <p className="tabular-nums text-base font-semibold text-[var(--emerald)]">
                  +{formatCentsDE(consolidatedSummary.calibratedInflowCents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Erkannte Fixkosten
                </p>
                <p className="tabular-nums text-base font-semibold text-[var(--rose)]">
                  −{formatCentsDE(consolidatedSummary.calibratedFixedOutflowCents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Variable Alltagskosten (
                  {variableBasis === "budget"
                    ? "Plan-Budget"
                    : variableBasis === "avg_3m"
                      ? "Ø 3M"
                      : "Ø 6M"}
                  )
                </p>
                <p className="tabular-nums text-base font-semibold text-[var(--rose)]">
                  −{formatCentsDE(consolidatedSummary.variableOutflowCents)}
                </p>
              </CardContent>
            </Card>
          </div>

          {householdData.household.categoriesBreakdown.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => setBreakdownOpen((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>
                  Aufschlüsselung variabler Kategorien (
                  <span className="tabular-nums">
                    {householdData.household.categoriesBreakdown.length}
                  </span>
                  )
                </span>
                {breakdownOpen ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {breakdownOpen ? (
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
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Sektion 1: Optionale Plan-Posten (Modelliert) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              Optionale Plan-Posten
            </h2>
            <StatusBadge variant="modeled" />
          </div>
          <span className="text-xs text-[var(--text-secondary)]">
            <span className="tabular-nums">{manualItems.length}</span> manuell ·{" "}
            <span className="tabular-nums">{derivedContractItems.length}</span>{" "}
            Verträge
          </span>
        </div>

        {manualItems.length === 0 ? (
          <Card className="border-dashed border-[var(--border-sub)]">
            <CardContent className="flex flex-col items-center justify-between gap-3 py-8 text-center sm:flex-row sm:text-left">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Noch keine optionalen Plan-Posten
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Erfasse bei Bedarf zusätzliche geplante Einnahmen oder
                  Ausgaben (z. B. künftige Kosten oder Sonderposten), die nicht
                  im Gemeinschaftskonto enthalten sind.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingCashflowItem(null);
                  setCashflowModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Ersten Plan-Posten anlegen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {manualItems.map((item) => {
              const monthlyCents = normalizeItemToMonthlyCents(
                item.amountCents,
                item.frequency,
              );
              const isConfirming = confirmDeleteCashflowId === item.id;

              return (
                <Card
                  key={item.id}
                  className={cn(
                    "border-dashed border-[var(--border-sub)] transition-opacity",
                    !item.active && "opacity-60",
                  )}
                >
                  <CardContent className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {item.name}
                        </span>
                        <StatusBadge variant="modeled" />
                        <Badge
                          variant="outline"
                          className={
                            item.direction === "inflow"
                              ? "border-[var(--emerald)]/35 bg-[var(--emerald)]/10 text-[var(--emerald)]"
                              : "border-[var(--rose)]/35 bg-[var(--rose)]/10 text-[var(--rose)]"
                          }
                        >
                          {item.direction === "inflow" ? "Einnahme" : "Ausgabe"}
                        </Badge>
                        {!item.active ? (
                          <Badge variant="secondary">Inaktiv</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Original:{" "}
                        <span className="tabular-nums">
                          {formatCentsDE(item.amountCents)}
                        </span>{" "}
                        ({FREQUENCY_LABELS[item.frequency]})
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                      <div className="text-right">
                        <div
                          className={cn(
                            "tabular-nums text-sm font-semibold",
                            item.direction === "inflow"
                              ? "text-[var(--emerald)]"
                              : "text-[var(--rose)]",
                          )}
                        >
                          {item.direction === "inflow" ? "+" : "−"}
                          {formatCentsDE(monthlyCents)}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          pro Monat
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => handleToggleCashflowActive(item)}
                        >
                          {item.active ? "Deaktivieren" : "Aktivieren"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${item.name} bearbeiten`}
                          onClick={() => {
                            setEditingCashflowItem(item);
                            setCashflowModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {isConfirming ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busyId === item.id}
                              className="border-[var(--rose)]/40 text-[var(--rose)]"
                              onClick={() => handleDeleteCashflowItem(item.id)}
                            >
                              Bestätigen
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeleteCashflowId(null)}
                            >
                              Abbruch
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${item.name} löschen`}
                            onClick={() => setConfirmDeleteCashflowId(item.id)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Verknüpfte Coruscant-Vertragsraten (Live-Sync, schreibgeschützt) */}
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Verknüpfte Coruscant-Vertragsraten
              </h3>
              <Badge variant="default">Live-Sync</Badge>
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
              <Link
                href="/vertraege"
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Verträge verwalten →
              </Link>
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">
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
            <p className="text-[11px] text-[var(--text-secondary)]">
              Hinweis:{" "}
              <span className="tabular-nums">{excludedContractsCount}</span>{" "}
              persönliche oder pausierte/geschlossene Verträge fließen bewusst
              nicht in den Haushalts-Cashflow ein.
            </p>
          ) : null}
        </div>
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
              const isLinkMissing = isLinked && linkStatus?.status !== "ok" && linkStatus?.status !== "conflict";
              const isLinkConflict = isLinked && linkStatus?.status === "conflict";
              const isLinkStale = isLinkMissing || isLinkConflict;

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
                          <Badge variant="default" className="tabular-nums">
                            #{pot.priority}
                          </Badge>
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

                    {progressPct !== null ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            targetReached
                              ? "bg-[var(--emerald)]"
                              : "bg-[var(--accent)]",
                          )}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    ) : null}
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
      <CashflowItemModal
        open={cashflowModalOpen}
        onOpenChange={setCashflowModalOpen}
        initialItem={editingCashflowItem}
        onSaved={() => router.refresh()}
      />

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
        onOpenChange={setAllocateModalOpen}
        pots={pots}
        pendingTransferCentsByPotId={pendingTransferCentsByPotId}
        monthlySurplusCents={consolidatedSummary.monthlySurplusCents}
        onAllocated={({ transferPlanCount }) => {
          setTransferPlanNotice(transferPlanCount > 0 ? transferPlanCount : null);
          router.refresh();
        }}
      />
    </div>
  );
}
