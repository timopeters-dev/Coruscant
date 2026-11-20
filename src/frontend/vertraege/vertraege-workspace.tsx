"use client";

import { Equation, EquationOperator, EquationTerm } from "@/frontend/ui/equation";
import { formatDateDE } from "@/domain/core/date-format";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Landmark,
  Plus,
} from "lucide-react";
import { Sparkline } from "@/frontend/charts/sparkline";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Card } from "@/frontend/ui/card";
import type { FinancialContractRow, PropertyRow } from "@/backend/db/queries/contracts";
import type { DocumentRow } from "@/backend/db/queries/documents";
import {
  type ContractMilestone,
  type ContractProjectionResult,
  extractContractMilestones,
} from "@/domain/contracts/contract";
import type { ContractOverview } from "@/domain/contracts/series";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import type { PropertySummary } from "@/domain/properties/properties";
import type {
  RentalMetrics,
  RentalPortfolioSummary,
} from "@/domain/properties/rental";
import {
  buildLoanDraftFromPurchase,
  type ContractLoanDraft,
  type PurchaseDraft,
} from "@/validation/property-draft";
import { ContractDetailDrawer } from "./contract-detail-drawer";
import { ContractModal } from "./contract-modal";
import {
  formatMonthYearDE,
  getContractTypeLabel,
  PROPERTY_USAGE_LABELS,
} from "./labels";
import {
  type MaintenancePotSummary,
  PropertyDetailDrawer,
} from "./property-detail-drawer";
import { PropertyModal } from "./property-modal";
import { cn } from "@/frontend/ui/cn";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/frontend/ui/segmented";

interface VertraegeWorkspaceProps {
  asOfDate: string;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  propertySummaries: Record<string, PropertySummary>;
  rentalPortfolio: RentalPortfolioSummary;
  pots: MaintenancePotSummary[];
  projectionsById: Record<string, ContractProjectionResult>;
  contractOverviewById: Record<string, ContractOverview>;
  showDebug: boolean;
  documentsByContractId: Record<string, DocumentRow[]>;
  documentsByPropertyId: Record<string, DocumentRow[]>;
  initialTab?: "uebersicht" | "portfolio";
  initialDraft?: PurchaseDraft | null;
  draftErrorReason?: string | null;
}

type WorkspaceTab = "uebersicht" | "portfolio";

export function VertraegeWorkspace({
  asOfDate,
  properties,
  contracts,
  propertySummaries,
  rentalPortfolio,
  pots,
  projectionsById,
  contractOverviewById,
  showDebug,
  documentsByContractId,
  documentsByPropertyId,
  initialTab = "uebersicht",
  initialDraft = null,
  draftErrorReason = null,
}: VertraegeWorkspaceProps) {
  const router = useRouter();

  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>(initialTab);
  const [showClosed, setShowClosed] = React.useState(false);

  const [selectedPropertyId, setSelectedPropertyId] = React.useState<
    string | null
  >(null);
  const [selectedContractId, setSelectedContractId] = React.useState<
    string | null
  >(null);

  const [propertyModalOpen, setPropertyModalOpen] = React.useState(
    Boolean(initialDraft),
  );
  const [editingProperty, setEditingProperty] =
    React.useState<PropertyRow | null>(null);
  const [activePropertyDraft, setActivePropertyDraft] =
    React.useState<PurchaseDraft | null>(initialDraft);

  const [loanDraft, setLoanDraft] = React.useState<PurchaseDraft | null>(null);
  const [loanDraftPropertyId, setLoanDraftPropertyId] = React.useState<
    string | null
  >(null);

  const [contractModalOpen, setContractModalOpen] = React.useState(false);
  const [editingContract, setEditingContract] =
    React.useState<FinancialContractRow | null>(null);
  const [activeContractDraft, setActiveContractDraft] =
    React.useState<ContractLoanDraft | null>(null);

  const [draftNotice, setDraftNotice] = React.useState<string | null>(
    draftErrorReason,
  );

  React.useEffect(() => {
    if (initialDraft || draftErrorReason) {
      router.replace("/vertraege", { scroll: false });
    }
    // Only clean URL query params on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rentalMetricsByPropertyId = React.useMemo(() => {
    const map = new Map<string, RentalMetrics>();
    for (const item of rentalPortfolio.items) {
      map.set(item.propertyId, item);
    }
    return map;
  }, [rentalPortfolio.items]);

  const potById = React.useMemo(() => {
    const map = new Map<string, MaintenancePotSummary>();
    for (const pot of pots) {
      map.set(pot.id, pot);
    }
    return map;
  }, [pots]);

  const propertyById = React.useMemo(() => {
    const map = new Map<string, PropertyRow>();
    for (const property of properties) {
      map.set(property.id, property);
    }
    return map;
  }, [properties]);

  const nextMilestoneByContractId = React.useMemo(() => {
    const milestones = extractContractMilestones(contracts, asOfDate);
    const map = new Map<string, ContractMilestone>();
    for (const milestone of milestones) {
      const existing = map.get(milestone.contractId);
      if (!existing) {
        map.set(milestone.contractId, milestone);
      } else if (existing.isOverdue && !milestone.isOverdue) {
        map.set(milestone.contractId, milestone);
      }
    }
    return map;
  }, [contracts, asOfDate]);

  const selectedProperty = selectedPropertyId
    ? (propertyById.get(selectedPropertyId) ?? null)
    : null;

  const selectedContract = selectedContractId
    ? (contracts.find((c) => c.id === selectedContractId) ?? null)
    : null;

  const activeLoans = React.useMemo(
    () =>
      contracts.filter(
        (c) => c.status !== "closed" && c.category === "loan",
      ),
    [contracts],
  );

  const activeSavings = React.useMemo(
    () =>
      contracts.filter(
        (c) => c.status !== "closed" && c.category === "savings_contract",
      ),
    [contracts],
  );

  const closedContracts = React.useMemo(
    () => contracts.filter((c) => c.status === "closed"),
    [contracts],
  );

  const summaryTotals = React.useMemo(() => {
    let loanCents = 0;
    let savingsCents = 0;
    let propertyCents = 0;
    let modeled = false;

    for (const c of activeLoans) {
      const proj = projectionsById[c.id];
      loanCents += proj?.projectedBalanceCents ?? c.currentBalanceCents;
      if (proj?.isProjected) modeled = true;
    }
    for (const c of activeSavings) {
      const proj = projectionsById[c.id];
      savingsCents += proj?.projectedBalanceCents ?? c.currentBalanceCents;
      if (proj?.isProjected) modeled = true;
    }
    for (const p of properties) {
      propertyCents += p.estimatedValueCents;
      const isCalibrated =
        p.purchasePriceCents != null &&
        p.estimatedValueCents === p.purchasePriceCents;
      if (!isCalibrated) modeled = true;
    }

    return {
      loanCents,
      savingsCents,
      propertyCents,
      modeled,
    };
  }, [activeLoans, activeSavings, properties, projectionsById]);

  function handleRefresh() {
    router.refresh();
  }

  function handleTabChange(nextTab: WorkspaceTab) {
    setActiveTab(nextTab);
    router.replace(nextTab === "portfolio" ? "?tab=portfolio" : "?tab=uebersicht", {
      scroll: false,
    });
  }

  function openNewPropertyModal() {
    setEditingProperty(null);
    setActivePropertyDraft(null);
    setPropertyModalOpen(true);
  }

  function openEditPropertyModal(property: PropertyRow) {
    setSelectedPropertyId(null);
    setEditingProperty(property);
    setActivePropertyDraft(null);
    setPropertyModalOpen(true);
  }

  function openNewContractModal() {
    setEditingContract(null);
    setActiveContractDraft(null);
    setContractModalOpen(true);
  }

  function openEditContractModal(contract: FinancialContractRow) {
    setSelectedContractId(null);
    setEditingContract(contract);
    setActiveContractDraft(null);
    setContractModalOpen(true);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="page-title">
            Verträge &amp; Immobilien
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Generisches Register für Kredite, Darlehen, Bausparverträge
            und Immobilien ·{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              Stand: {formatDateDE(asOfDate)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentGroup>
          <div
            role="tablist"
            aria-label="Ansicht"
            className={SEGMENT_TRACK}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "uebersicht"}
              onClick={() => handleTabChange("uebersicht")}
              className={cn(segmentItemClass(activeTab === "uebersicht"), "px-3 py-1.5")}
            >
              {activeTab === "uebersicht" ? <SegmentPill /> : null}
              <SegmentLabel>Übersicht</SegmentLabel>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "portfolio"}
              onClick={() => handleTabChange("portfolio")}
              className={cn(segmentItemClass(activeTab === "portfolio"), "px-3 py-1.5")}
            >
              {activeTab === "portfolio" ? <SegmentPill /> : null}
              <SegmentLabel>Portfolio</SegmentLabel>
            </button>
          </div>
          </SegmentGroup>
          <Button variant="outline" onClick={openNewPropertyModal}>
            <Plus className="h-4 w-4" />
            Immobilie
          </Button>
          <Button onClick={openNewContractModal}>
            <Plus className="h-4 w-4" />
            Vertrag
          </Button>
        </div>
      </header>

      {draftNotice ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/60 px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <span>{draftNotice}</span>
          <button
            type="button"
            onClick={() => setDraftNotice(null)}
            className="font-medium text-[var(--text-primary)] hover:underline"
          >
            Schließen
          </button>
        </div>
      ) : null}

      {activeTab === "portfolio" ? (
        <section className="space-y-6">
          {!rentalPortfolio.hasData ? (
            <Card className="border-dashed border-[var(--border-sub)] p-6">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <p className="text-sm text-[var(--text-secondary)]">
                  Noch kein vermietetes Objekt. Nutzungsart ‚Vermietet‘ im
                  Objekt wählen oder den Kaufrechner nutzen.
                </p>
                <Link
                  href="/planung/kaufrechner"
                  className="inline-flex shrink-0 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-elevated)]"
                >
                  Zum Kaufrechner
                </Link>
              </div>
            </Card>
          ) : (
            <>
              {(() => {
                const t = rentalPortfolio.totals;
                const ratesCents =
                  t.monthlyLoanRatesCents + t.monthlySavingsRatesCents;
                const ltvBps = rentalPortfolio.ltvBps;
                return (
                  <>
                    <Equation label="Monatlicher Cashflow vor Steuern" modeled>
                      <EquationTerm
                        size="md"
                        label="Kaltmiete / Monat"
                        value={formatCentsDE(t.monthlyColdRentCents)}
                      />
                      {t.monthlyNonRecoverableCostsCents > 0 ? (
                        <EquationOperator symbol="−" label="minus" />
                      ) : null}
                      {t.monthlyNonRecoverableCostsCents > 0 ? (
                        <EquationTerm
                          size="md"
                          label="Objektkosten"
                          value={formatCentsDE(
                            t.monthlyNonRecoverableCostsCents,
                          )}
                          valueClassName="text-[var(--rose)]"
                        >
                          <p className="text-xs text-[var(--text-secondary)]">
                            nicht umlagefähig
                          </p>
                        </EquationTerm>
                      ) : null}
                      <EquationOperator symbol="−" label="minus" />
                      <EquationTerm
                        size="md"
                        label="Raten"
                        value={formatCentsDE(ratesCents)}
                        valueClassName="text-[var(--rose)]"
                      />
                      <EquationOperator symbol="=" label="ergibt" />
                      <EquationTerm
                        size="md"
                        emphasis
                        modeled
                        label="Cashflow / Monat"
                        value={formatCentsDE(t.netCashflowBeforeReserveCents, {
                          showPlusSign: true,
                        })}
                        valueClassName={
                          t.netCashflowBeforeReserveCents >= 0
                            ? "text-[var(--emerald)]"
                            : "text-[var(--rose)]"
                        }
                      >
                        <p className="text-xs text-[var(--text-secondary)]">
                          nach Instandhaltungsrücklage{" "}
                          <span className="font-medium text-[var(--text-primary)]">
                            {formatCentsDE(t.netCashflowAfterReserveCents, {
                              showPlusSign: true,
                            })}
                          </span>
                        </p>
                      </EquationTerm>
                    </Equation>

                    <Equation
                      label="Vermögen in den Mietobjekten"
                      modeled
                      footer={
                        ltvBps !== null ? (
                          <div className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--text-secondary)]">
                              <span>Beleihung</span>
                              <span className="font-medium text-[var(--text-primary)]">
                                {formatBpsDE(ltvBps)}
                              </span>
                            </div>
                            <div
                              className="meter h-2.5 w-full overflow-hidden"
                              role="img"
                              aria-label={`Beleihung ${formatBpsDE(ltvBps)} des Objektwerts`}
                            >
                              <div
                                className="h-full bg-[var(--rose)]"
                                style={{
                                  width: `${Math.min(100, Math.max(0, ltvBps / 100))}%`,
                                }}
                              />
                            </div>
                            <div className="scale-ticks" aria-hidden="true" />
                          </div>
                        ) : null
                      }
                    >
                      <EquationTerm
                        size="md"
                        label="Objektwert"
                        value={formatCentsDE(t.estimatedValueCents)}
                        valueClassName="text-[var(--sky)]"
                      />
                      <EquationOperator symbol="−" label="minus" />
                      <EquationTerm
                        size="md"
                        label="Restschuld"
                        value={formatCentsDE(t.linkedLoanBalanceCents)}
                        valueClassName="text-[var(--rose)]"
                      />
                      <EquationOperator symbol="=" label="ergibt" />
                      <EquationTerm
                        size="md"
                        emphasis
                        modeled
                        label="Eigenkapital im Objekt"
                        value={formatCentsDE(t.capitalTiedCents)}
                        valueClassName={
                          t.capitalTiedCents >= 0
                            ? "text-[var(--emerald)]"
                            : "text-[var(--rose)]"
                        }
                      />
                    </Equation>
                  </>
                );
              })()}

              <Card className="overflow-x-auto border-dashed border-[var(--border-sub)]">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    Je Objekt
                  </h2>
                  <StatusBadge variant="modeled" />
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--border-sub)] text-xs text-[var(--text-secondary)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Objekt</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Miete
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Raten
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Cashflow
                      </th>
                      <th className="px-4 py-3 text-right font-medium">Wert</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Restschuld
                      </th>
                      <th className="px-4 py-3 text-right font-medium">EK</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Bruttorendite
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {rentalPortfolio.items.map((item) => {
                      const prop = propertyById.get(item.propertyId);
                      if (!prop) return null;
                      const rates =
                        item.monthlyLoanRatesCents +
                        item.monthlySavingsRatesCents;
                      return (
                        <tr
                          key={item.propertyId}
                          onClick={() => setSelectedPropertyId(item.propertyId)}
                          className="cursor-pointer transition-colors hover:bg-[var(--surface-elevated)]/40"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                            {prop.name}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right">
                            {formatCentsDE(item.monthlyColdRentCents)}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right text-[var(--rose)]">
                            {formatCentsDE(rates)}
                          </td>
                          <td
                            className={`tabular-nums px-4 py-3 text-right font-medium ${
                              item.netCashflowBeforeReserveCents >= 0
                                ? "text-[var(--emerald)]"
                                : "text-[var(--rose)]"
                            }`}
                          >
                            {formatCentsDE(item.netCashflowBeforeReserveCents, {
                              showPlusSign: true,
                            })}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right text-[var(--sky)]">
                            {formatCentsDE(item.estimatedValueCents)}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right text-[var(--rose)]">
                            {formatCentsDE(item.linkedLoanBalanceCents)}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right">
                            {formatCentsDE(item.capitalTiedCents)}
                          </td>
                          <td className="tabular-nums px-4 py-3 text-right">
                            {item.grossYieldBps != null
                              ? formatBpsDE(item.grossYieldBps)
                              : "–"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              <p className="text-xs text-[var(--text-secondary)]">
                vor Steuern; keine AfA, kein Zinsabzug. Rendite auf Kaufpreis.
                {rentalPortfolio.yieldCoverage === "partial"
                  ? " Rendite nur über Objekte mit Kaufpreis."
                  : ""}
              </p>
            </>
          )}
        </section>
      ) : (
        <>
          {properties.length === 0 &&
          activeLoans.length === 0 &&
          activeSavings.length === 0 &&
          closedContracts.length === 0 ? (
            <Card className="border-dashed border-[var(--border-sub)] p-6">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Noch keine Verträge oder Immobilien erfasst
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Erfasse Kredite, Darlehen, Bausparverträge oder Immobilie #0
                    ohne hartcodierte Sonderfälle.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={openNewPropertyModal}>
                    <Plus className="h-4 w-4" />
                    Immobilie anlegen
                  </Button>
                  <Button variant="secondary" onClick={openNewContractModal}>
                    <Plus className="h-4 w-4" />
                    Vertrag anlegen
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* Ruhige Summenzeile */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm ${
                  summaryTotals.modeled
                    ? "border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <p className="tabular-nums text-[var(--text-secondary)]">
                  Restschuld{" "}
                  <strong className="font-semibold text-[var(--rose)]">
                    {formatCentsDE(summaryTotals.loanCents)}
                  </strong>{" "}
                  · Bausparguthaben{" "}
                  <strong className="font-semibold text-[var(--sky)]">
                    {formatCentsDE(summaryTotals.savingsCents)}
                  </strong>{" "}
                  · Immobilienwerte{" "}
                  <strong className="font-semibold text-[var(--text-primary)]">
                    {formatCentsDE(summaryTotals.propertyCents)}
                  </strong>
                </p>
                {summaryTotals.modeled ? (
                  <StatusBadge variant="modeled" label="Modelliert" />
                ) : (
                  <StatusBadge variant="calibrated" label="Geeicht" />
                )}
              </div>

              {/* Gruppe 1: Kredite */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-[var(--rose)]" />
                    <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                      Kredite
                    </h2>
                    <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                      ({activeLoans.length})
                    </span>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-[var(--rose)]">
                    {formatCentsDE(summaryTotals.loanCents)}
                  </span>
                </div>

                {activeLoans.length === 0 ? (
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-[var(--border-sub)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                    <span>Keine aktiven Kredite erfasst.</span>
                    <button
                      type="button"
                      onClick={openNewContractModal}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      + anlegen
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeLoans.map((contract) => {
                      const projection = projectionsById[contract.id];
                      const overview = contractOverviewById[contract.id];
                      const isProjected = projection?.isProjected ?? false;
                      const balanceCents =
                        projection?.projectedBalanceCents ??
                        contract.currentBalanceCents;
                      const linkedProperty = contract.linkedPropertyId
                        ? (propertyById.get(contract.linkedPropertyId) ?? null)
                        : null;
                      const nextMilestone = nextMilestoneByContractId.get(
                        contract.id,
                      );
                      const nextDate = nextMilestone?.date ?? null;
                      const nextLabel = nextMilestone
                        ? nextMilestone.kind === "milestone"
                          ? (contract.milestoneLabel?.trim() || "Meilenstein")
                          : nextMilestone.label
                        : null;

                      return (
                        <Card
                          key={contract.id}
                          interactive
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedContractId(contract.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedContractId(contract.id);
                            }
                          }}
                          className={`cursor-pointer p-5 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] ${
                            isProjected
                              ? "border-dashed border-[var(--border-sub)]"
                              : "border-[var(--border)]"
                          }`}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                                  {contract.name}
                                </h3>
                                {contract.provider ? (
                                  <span className="text-xs text-[var(--text-secondary)]">
                                    · {contract.provider}
                                  </span>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline">
                                  {getContractTypeLabel(
                                    contract.category,
                                    contract.repaymentType,
                                  )}
                                </Badge>
                                {contract.status === "paused" ? (
                                  <Badge className="border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]">
                                    Pausiert
                                  </Badge>
                                ) : null}
                                {isProjected ? (
                                  <StatusBadge
                                    variant="modeled"
                                    label="Projiziert"
                                    detail={`Geeicht ${formatDateDE(contract.balanceAsOfDate)}`}
                                  />
                                ) : (
                                  <StatusBadge
                                    variant="calibrated"
                                    label="Geeicht"
                                    detail={formatDateDE(contract.balanceAsOfDate)}
                                  />
                                )}
                                {overview?.isCalibrationStale ? (
                                  <Badge className="border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]">
                                    Stand alt
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                                <span>
                                  Zins:{" "}
                                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                                    {formatBpsDE(contract.interestRateBps)}
                                  </span>
                                </span>
                                <span>
                                  Rate:{" "}
                                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                                    {formatCentsDE(contract.monthlyRateCents)}
                                    /Monat
                                  </span>
                                </span>
                                {linkedProperty ? (
                                  <span>
                                    Immobilie:{" "}
                                    <span className="font-medium text-[var(--text-primary)]">
                                      {linkedProperty.name}
                                    </span>
                                  </span>
                                ) : null}
                                {nextDate && nextLabel ? (
                                  <span className="inline-flex items-center gap-1 text-[var(--amber)]">
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    <span>{nextLabel}:</span>
                                    <span className="tabular-nums font-medium">
                                      {formatDateDE(nextDate)}
                                    </span>
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                              <div className="text-left sm:text-right">
                                <p className="text-xs text-[var(--text-secondary)]">
                                  Restschuld
                                </p>
                                <p className="tabular-nums text-lg font-semibold text-[var(--rose)]">
                                  {formatCentsDE(balanceCents)}
                                </p>
                              </div>
                              {overview ? (
                                <div className="flex flex-col items-start sm:items-end">
                                  <Sparkline
                                    values={overview.sparklineCents}
                                    role="liabilities"
                                  />
                                  <span className="mt-0.5 tabular-nums text-2xs text-[var(--text-secondary)]">
                                    {overview.notProjected
                                      ? "Pausiert"
                                      : overview.paidOffDate
                                        ? `schuldenfrei ca. ${formatMonthYearDE(overview.paidOffDate)}`
                                        : overview.neverPaysOff
                                          ? "nicht absehbar"
                                          : overview.lumpSum
                                            ? "Endfällig"
                                            : ""}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Gruppe 2: Bausparer */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-[var(--sky)]" />
                    <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                      Bausparer
                    </h2>
                    <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                      ({activeSavings.length})
                    </span>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-[var(--sky)]">
                    {formatCentsDE(summaryTotals.savingsCents)}
                  </span>
                </div>

                {activeSavings.length === 0 ? (
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-[var(--border-sub)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                    <span>Keine aktiven Bausparverträge erfasst.</span>
                    <button
                      type="button"
                      onClick={openNewContractModal}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      + anlegen
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeSavings.map((contract) => {
                      const projection = projectionsById[contract.id];
                      const overview = contractOverviewById[contract.id];
                      const isProjected = projection?.isProjected ?? false;
                      const balanceCents =
                        projection?.projectedBalanceCents ??
                        contract.currentBalanceCents;
                      const linkedProperty = contract.linkedPropertyId
                        ? (propertyById.get(contract.linkedPropertyId) ?? null)
                        : null;
                      const progressPct =
                        overview?.targetProgressBps != null
                          ? Math.min(
                              100,
                              Math.round(overview.targetProgressBps / 100),
                            )
                          : null;
                      const thresholdPct =
                        overview?.thresholdBps != null
                          ? Math.min(
                              100,
                              Math.round(overview.thresholdBps / 100),
                            )
                          : null;

                      return (
                        <Card
                          key={contract.id}
                          interactive
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedContractId(contract.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedContractId(contract.id);
                            }
                          }}
                          className={`cursor-pointer p-5 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] ${
                            isProjected
                              ? "border-dashed border-[var(--border-sub)]"
                              : "border-[var(--border)]"
                          }`}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                                  {contract.name}
                                </h3>
                                {contract.provider ? (
                                  <span className="text-xs text-[var(--text-secondary)]">
                                    · {contract.provider}
                                  </span>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline">
                                  {getContractTypeLabel(
                                    contract.category,
                                    contract.repaymentType,
                                  )}
                                </Badge>
                                {contract.status === "paused" ? (
                                  <Badge className="border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]">
                                    Pausiert
                                  </Badge>
                                ) : null}
                                {isProjected ? (
                                  <StatusBadge
                                    variant="modeled"
                                    label="Projiziert"
                                    detail={`Geeicht ${formatDateDE(contract.balanceAsOfDate)}`}
                                  />
                                ) : (
                                  <StatusBadge
                                    variant="calibrated"
                                    label="Geeicht"
                                    detail={formatDateDE(contract.balanceAsOfDate)}
                                  />
                                )}
                                {overview?.isCalibrationStale ? (
                                  <Badge className="border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]">
                                    Stand alt
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                                <span>
                                  Zins:{" "}
                                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                                    {formatBpsDE(contract.interestRateBps)}
                                  </span>
                                </span>
                                <span>
                                  Rate:{" "}
                                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                                    {formatCentsDE(contract.monthlyRateCents)}
                                    /Monat
                                  </span>
                                </span>
                                {linkedProperty ? (
                                  <span>
                                    Immobilie:{" "}
                                    <span className="font-medium text-[var(--text-primary)]">
                                      {linkedProperty.name}
                                    </span>
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                              <div className="text-left sm:text-right">
                                <p className="text-xs text-[var(--text-secondary)]">
                                  Guthaben
                                </p>
                                <p
                                  className={`tabular-nums text-lg font-semibold ${
                                    balanceCents < 0
                                      ? "text-[var(--rose)]"
                                      : "text-[var(--sky)]"
                                  }`}
                                >
                                  {formatCentsDE(balanceCents)}
                                </p>
                                {balanceCents < 0 ? (
                                  <p className="text-2xs text-[var(--text-secondary)]">
                                    im Minus durch Abschlussgebühr
                                  </p>
                                ) : null}
                              </div>
                              {progressPct !== null ? (
                                <div className="w-28 space-y-1">
                                  <div className="relative h-2 w-full meter overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                                    <div
                                      className="h-full rounded-full bg-[var(--sky)]"
                                      style={{ width: `${progressPct}%` }}
                                    />
                                    {thresholdPct !== null ? (
                                      <div
                                        className="absolute top-0 bottom-0 w-0.5 bg-[var(--amber)]"
                                        style={{ left: `${thresholdPct}%` }}
                                      />
                                    ) : null}
                                  </div>
                                  <p className="tabular-nums text-2xs text-[var(--text-secondary)]">
                                    {progressPct} % vom Ziel
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Gruppe 3: Immobilien */}
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[var(--sky)]" />
                    <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                      Immobilien
                    </h2>
                    <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                      ({properties.length})
                    </span>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                    {formatCentsDE(summaryTotals.propertyCents)}
                  </span>
                </div>

                {properties.length === 0 ? (
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-[var(--border-sub)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                    <span>Keine Immobilien erfasst.</span>
                    <button
                      type="button"
                      onClick={openNewPropertyModal}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      + anlegen
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {properties.map((property) => {
                      const summary = propertySummaries[property.id];
                      const isCalibrated =
                        property.purchasePriceCents != null &&
                        property.estimatedValueCents ===
                          property.purchasePriceCents;
                      const linked = contracts.filter(
                        (c) =>
                          c.linkedPropertyId === property.id &&
                          c.status !== "closed",
                      );
                      const ltvPct =
                        summary?.ltvBps != null
                          ? Math.min(100, Math.round(summary.ltvBps / 100))
                          : null;

                      return (
                        <Card
                          key={property.id}
                          interactive
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedPropertyId(property.id)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedPropertyId(property.id);
                            }
                          }}
                          className="cursor-pointer p-5 transition-colors hover:border-[var(--border-sub)] hover:bg-[var(--surface-elevated)]/30 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              {property.imagePath ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`/api/properties/${property.id}/image?v=${encodeURIComponent(property.updatedAt)}`}
                                  alt={property.name}
                                  className="h-14 w-14 shrink-0 rounded-lg border border-[var(--border)] object-cover"
                                />
                              ) : null}
                              <div className="min-w-0 space-y-1">
                                <h3 className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]">
                                  {property.name}
                                </h3>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <Badge variant="secondary">
                                    {PROPERTY_USAGE_LABELS[property.usage]}
                                  </Badge>
                                  {(() => {
                                    const location = [
                                      property.postalCode,
                                      property.city,
                                    ]
                                      .filter(Boolean)
                                      .join(" ");
                                    const metaParts = [
                                      location,
                                      property.livingAreaSqm != null
                                        ? `${property.livingAreaSqm} m²`
                                        : "",
                                    ].filter(Boolean);
                                    if (metaParts.length === 0) return null;
                                    return (
                                      <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                                        {metaParts.join(" · ")}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                            {isCalibrated ? (
                              <StatusBadge
                                variant="calibrated"
                                detail="Kaufpreis"
                              />
                            ) : (
                              <StatusBadge
                                variant="modeled"
                                detail="Schätzwert"
                              />
                            )}
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div
                              className={
                                isCalibrated
                                  ? "rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3"
                                  : "rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-3"
                              }
                            >
                              <p className="text-xs text-[var(--text-secondary)]">
                                Geschätzter Wert
                              </p>
                              <p className="mt-0.5 tabular-nums text-sm font-semibold text-[var(--sky)]">
                                {formatCentsDE(property.estimatedValueCents)}
                              </p>
                            </div>

                            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3">
                              <p className="text-xs text-[var(--text-secondary)]">
                                Restschulden
                              </p>
                              <p className="mt-0.5 tabular-nums text-sm font-semibold text-[var(--rose)]">
                                {formatCentsDE(
                                  summary?.linkedLoanBalanceCents ?? 0,
                                )}
                              </p>
                            </div>

                            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3">
                              <p className="text-xs text-[var(--text-secondary)]">
                                Eigenkapital
                                {summary?.ltvBps != null ? (
                                  <>
                                    {" · LTV "}
                                    <span className="tabular-nums">
                                      {formatBpsDE(summary.ltvBps)}
                                    </span>
                                  </>
                                ) : null}
                              </p>
                              <p
                                className={`mt-0.5 tabular-nums text-sm font-semibold ${
                                  (summary?.netEquityCents ?? 0) >= 0
                                    ? "text-[var(--emerald)]"
                                    : "text-[var(--rose)]"
                                }`}
                              >
                                {formatCentsDE(
                                  summary?.netEquityCents ??
                                    property.estimatedValueCents,
                                )}
                              </p>
                            </div>
                          </div>

                          {ltvPct !== null ? (
                            <div className="mt-3 flex items-center gap-3">
                              <div className="h-1.5 flex-1 meter overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                                <div
                                  className="h-full rounded-full bg-[var(--rose)]"
                                  style={{ width: `${ltvPct}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-2xs text-[var(--text-secondary)]">
                                Beleihung {ltvPct} %
                              </span>
                            </div>
                          ) : null}

                          {property.usage === "rented"
                            ? (() => {
                                const rm = rentalMetricsByPropertyId.get(
                                  property.id,
                                );
                                if (!rm) return null;
                                return (
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 px-3 py-2 text-xs">
                                    <span className="tabular-nums text-[var(--text-secondary)]">
                                      Miete{" "}
                                      <strong className="font-medium text-[var(--text-primary)]">
                                        {formatCentsDE(rm.monthlyColdRentCents)}
                                      </strong>{" "}
                                      · Cashflow{" "}
                                      <strong
                                        className={
                                          rm.netCashflowBeforeReserveCents >= 0
                                            ? "font-medium text-[var(--emerald)]"
                                            : "font-medium text-[var(--rose)]"
                                        }
                                      >
                                        {formatCentsDE(
                                          rm.netCashflowBeforeReserveCents,
                                          { showPlusSign: true },
                                        )}
                                      </strong>
                                      /Monat
                                    </span>
                                    <StatusBadge variant="modeled" />
                                  </div>
                                );
                              })()
                            : null}

                          {linked.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-1.5">
                              {linked.map((contract) => (
                                <button
                                  key={contract.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedContractId(contract.id);
                                  }}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-elevated)]"
                                >
                                  <span>{contract.name}</span>
                                  <span
                                    className={`tabular-nums font-medium ${
                                      contract.category === "loan"
                                        ? "text-[var(--rose)]"
                                        : "text-[var(--sky)]"
                                    }`}
                                  >
                                    {formatCentsDE(
                                      projectionsById[contract.id]
                                        ?.projectedBalanceCents ??
                                        contract.currentBalanceCents,
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Beendet (eingeklappt) */}
              {closedContracts.length > 0 ? (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowClosed((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {showClosed ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span>Beendet ({closedContracts.length})</span>
                  </button>

                  {showClosed ? (
                    <div className="mt-3 space-y-2">
                      {closedContracts.map((contract) => (
                        <Card
                          key={contract.id}
                          interactive
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedContractId(contract.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedContractId(contract.id);
                            }
                          }}
                          className="cursor-pointer p-4 opacity-75 transition-opacity hover:opacity-100"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                                {contract.name}
                              </p>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {getContractTypeLabel(
                                  contract.category,
                                  contract.repaymentType,
                                )}{" "}
                                · Beendet
                              </p>
                            </div>
                            <span className="tabular-nums text-sm font-semibold text-[var(--text-secondary)]">
                              {formatCentsDE(contract.currentBalanceCents)}
                            </span>
                          </div>
                        </Card>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      <PropertyModal
        open={propertyModalOpen}
        onOpenChange={(open) => {
          setPropertyModalOpen(open);
          if (!open) {
            setActivePropertyDraft(null);
          }
        }}
        initialProperty={editingProperty}
        draft={activePropertyDraft}
        pots={pots}
        onSaved={(saved) => {
          if (activePropertyDraft && saved) {
            setLoanDraft(activePropertyDraft);
            setLoanDraftPropertyId(saved.id);
            setActivePropertyDraft(null);
            setSelectedPropertyId(saved.id);
          }
          handleRefresh();
        }}
      />

      <ContractModal
        open={contractModalOpen}
        onOpenChange={(open) => {
          setContractModalOpen(open);
          if (!open) {
            setActiveContractDraft(null);
          }
        }}
        properties={properties}
        asOfDate={asOfDate}
        initialContract={editingContract}
        draft={activeContractDraft}
        onSaved={() => {
          if (activeContractDraft) {
            setActiveContractDraft(null);
            setLoanDraft(null);
            setLoanDraftPropertyId(null);
          }
          handleRefresh();
        }}
      />

      <PropertyDetailDrawer
        property={selectedProperty}
        showDebug={showDebug}
        summary={
          selectedProperty
            ? (propertySummaries[selectedProperty.id] ?? null)
            : null
        }
        rentalMetrics={
          selectedProperty && selectedProperty.usage === "rented"
            ? (rentalMetricsByPropertyId.get(selectedProperty.id) ?? null)
            : null
        }
        maintenancePot={
          selectedProperty?.maintenanceReservePotId
            ? (potById.get(selectedProperty.maintenanceReservePotId) ?? null)
            : null
        }
        loanDraft={
          selectedProperty && selectedProperty.id === loanDraftPropertyId
            ? loanDraft
            : null
        }
        onCreateLoanFromDraft={() => {
          if (!selectedProperty || !loanDraft) return;
          const mapped = buildLoanDraftFromPurchase(
            loanDraft,
            selectedProperty.id,
            asOfDate,
          );
          if (!mapped) return;
          setSelectedPropertyId(null);
          setEditingContract(null);
          setActiveContractDraft(mapped);
          setContractModalOpen(true);
        }}
        onDiscardLoanDraft={() => {
          setLoanDraft(null);
          setLoanDraftPropertyId(null);
        }}
        linkedContracts={
          selectedProperty
            ? contracts.filter(
                (c) => c.linkedPropertyId === selectedProperty.id,
              )
            : []
        }
        unlinkedContracts={
          selectedProperty
            ? contracts.filter(
                (c) => c.linkedPropertyId === null && c.status !== "closed",
              )
            : []
        }
        linkedDocuments={
          selectedProperty
            ? (documentsByPropertyId[selectedProperty.id] ?? [])
            : []
        }
        projectionsById={projectionsById}
        asOfDate={asOfDate}
        onClose={() => setSelectedPropertyId(null)}
        onEdit={openEditPropertyModal}
        onSelectContract={(contract) => {
          setSelectedPropertyId(null);
          setSelectedContractId(contract.id);
        }}
        onMutated={handleRefresh}
      />

      <ContractDetailDrawer
        contract={selectedContract}
        projection={
          selectedContract
            ? (projectionsById[selectedContract.id] ?? null)
            : null
        }
        linkedProperty={
          selectedContract?.linkedPropertyId
            ? (propertyById.get(selectedContract.linkedPropertyId) ?? null)
            : null
        }
        linkedDocuments={
          selectedContract
            ? (documentsByContractId[selectedContract.id] ?? [])
            : []
        }
        asOfDate={asOfDate}
        onClose={() => setSelectedContractId(null)}
        onEdit={openEditContractModal}
        onMutated={handleRefresh}
      />
    </div>
  );
}
