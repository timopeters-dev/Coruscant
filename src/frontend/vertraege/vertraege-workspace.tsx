"use client";

import { Equation, EquationOperator, EquationTerm } from "@/frontend/ui/equation";
import { formatDateDE } from "@/domain/core/date-format";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Landmark,
  Plus,
} from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { Card } from "@/frontend/ui/card";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import {
  type ContractMilestone,
  type ContractProjectionResult,
  extractContractMilestones,
} from "@/domain/contracts/contract";
import type { ContractOverview } from "@/domain/contracts/amortization-types";
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
  getContractTypeLabel,
} from "./labels";
import {
  type MaintenancePotSummary,
  PropertyDetailDrawer,
} from "./property-detail-drawer";
import { PropertyModal } from "./property-modal";
import { ContractCard } from "./contract-card";
import { PropertyRegisterCard } from "./property-register-card";
import { RegisterSection } from "./register-section";
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

              <RegisterSection
                icon={Landmark}
                iconClassName="text-[var(--rose)]"
                title="Kredite"
                count={activeLoans.length}
                totalCents={summaryTotals.loanCents}
                totalClassName="text-[var(--rose)]"
                emptyText="Keine aktiven Kredite erfasst."
                onCreate={openNewContractModal}
              >
                <div className="space-y-3">
                  {activeLoans.map((contract) => (
                    <ContractCard
                      key={contract.id}
                      contract={contract}
                      projection={projectionsById[contract.id]}
                      overview={contractOverviewById[contract.id]}
                      linkedProperty={contract.linkedPropertyId ? (propertyById.get(contract.linkedPropertyId) ?? null) : null}
                      nextMilestone={nextMilestoneByContractId.get(contract.id)}
                      onOpen={() => setSelectedContractId(contract.id)}
                    />
                  ))}
                </div>
              </RegisterSection>

              <RegisterSection
                icon={Landmark}
                iconClassName="text-[var(--sky)]"
                title="Bausparer"
                count={activeSavings.length}
                totalCents={summaryTotals.savingsCents}
                totalClassName="text-[var(--sky)]"
                emptyText="Keine aktiven Bausparverträge erfasst."
                onCreate={openNewContractModal}
              >
                <div className="space-y-3">
                  {activeSavings.map((contract) => (
                    <ContractCard
                      key={contract.id}
                      contract={contract}
                      projection={projectionsById[contract.id]}
                      overview={contractOverviewById[contract.id]}
                      linkedProperty={contract.linkedPropertyId ? (propertyById.get(contract.linkedPropertyId) ?? null) : null}
                      nextMilestone={nextMilestoneByContractId.get(contract.id)}
                      onOpen={() => setSelectedContractId(contract.id)}
                    />
                  ))}
                </div>
              </RegisterSection>

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
                    {properties.map((property) => (
                      <PropertyRegisterCard
                        key={property.id}
                        property={property}
                        summary={propertySummaries[property.id]}
                        linked={contracts.filter((c) => c.linkedPropertyId === property.id && c.status !== "closed")}
                        rentalMetrics={rentalMetricsByPropertyId.get(property.id)}
                        projectionsById={projectionsById}
                        onOpen={() => setSelectedPropertyId(property.id)}
                        onOpenContract={setSelectedContractId}
                      />
                    ))}
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
