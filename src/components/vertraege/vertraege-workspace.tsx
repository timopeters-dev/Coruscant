"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Landmark,
  Plus,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type { DocumentRow } from "@/db/queries/documents";
import {
  type ContractCategory,
  type ContractMilestone,
  type ContractProjectionResult,
  type ContractSphere,
  extractContractMilestones,
} from "@/lib/domain/contracts";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import type { PropertySummary } from "@/lib/domain/properties";
import { ContractDetailDrawer } from "./contract-detail-drawer";
import { ContractModal } from "./contract-modal";
import {
  CONTRACT_SPHERE_LABELS,
  getContractTypeLabel,
  PROPERTY_USAGE_LABELS,
} from "./labels";
import { PropertyDetailDrawer } from "./property-detail-drawer";
import { PropertyModal } from "./property-modal";

interface VertraegeWorkspaceProps {
  asOfDate: string;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  propertySummaries: Record<string, PropertySummary>;
  projectionsById: Record<string, ContractProjectionResult>;
  documentsByContractId: Record<string, DocumentRow[]>;
  documentsByPropertyId: Record<string, DocumentRow[]>;
}

type CategoryFilter = "all" | ContractCategory;
type SphereFilter = "all" | ContractSphere;

export function VertraegeWorkspace({
  asOfDate,
  properties,
  contracts,
  propertySummaries,
  projectionsById,
  documentsByContractId,
  documentsByPropertyId,
}: VertraegeWorkspaceProps) {
  const router = useRouter();

  const [categoryFilter, setCategoryFilter] =
    React.useState<CategoryFilter>("all");
  const [sphereFilter, setSphereFilter] = React.useState<SphereFilter>("all");
  const [showClosed, setShowClosed] = React.useState(false);

  const [selectedPropertyId, setSelectedPropertyId] = React.useState<
    string | null
  >(null);
  const [selectedContractId, setSelectedContractId] = React.useState<
    string | null
  >(null);

  const [propertyModalOpen, setPropertyModalOpen] = React.useState(false);
  const [editingProperty, setEditingProperty] =
    React.useState<PropertyRow | null>(null);

  const [contractModalOpen, setContractModalOpen] = React.useState(false);
  const [editingContract, setEditingContract] =
    React.useState<FinancialContractRow | null>(null);

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

  const filteredContracts = React.useMemo(() => {
    return contracts.filter((contract) => {
      if (categoryFilter !== "all" && contract.category !== categoryFilter) {
        return false;
      }
      if (sphereFilter !== "all" && contract.sphere !== sphereFilter) {
        return false;
      }
      return true;
    });
  }, [contracts, categoryFilter, sphereFilter]);

  const activeAndPausedContracts = React.useMemo(
    () => filteredContracts.filter((c) => c.status !== "closed"),
    [filteredContracts],
  );

  const closedContracts = React.useMemo(
    () => filteredContracts.filter((c) => c.status === "closed"),
    [filteredContracts],
  );

  function handleRefresh() {
    router.refresh();
  }

  function openNewPropertyModal() {
    setEditingProperty(null);
    setPropertyModalOpen(true);
  }

  function openEditPropertyModal(property: PropertyRow) {
    setSelectedPropertyId(null);
    setEditingProperty(property);
    setPropertyModalOpen(true);
  }

  function openNewContractModal() {
    setEditingContract(null);
    setContractModalOpen(true);
  }

  function openEditContractModal(contract: FinancialContractRow) {
    setSelectedContractId(null);
    setEditingContract(contract);
    setContractModalOpen(true);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Verträge &amp; Immobilien
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Generisches Register für Kredite, Privatdarlehen, Bausparverträge
            und Immobilie #0 ·{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              Stand: {asOfDate}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      {/* Sektion: Immobilien */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--sky)]" />
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Immobilien
            </h2>
          </div>
          <span className="tabular-nums text-xs text-[var(--text-secondary)]">
            {properties.length} {properties.length === 1 ? "Objekt" : "Objekte"}
          </span>
        </div>

        {properties.length === 0 ? (
          <Card className="border-dashed border-[var(--border-sub)] p-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Noch keine Immobilie erfasst
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Lege Immobilie #0 an, um geschätzten Wert, Eigenkapital und
                  verknüpfte Finanzierungen zu verfolgen.
                </p>
              </div>
              <Button variant="secondary" onClick={openNewPropertyModal}>
                <Plus className="h-4 w-4" />
                Immobilie #0 anlegen
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {properties.map((property) => {
              const summary = propertySummaries[property.id];
              const isCalibrated =
                property.purchasePriceCents != null &&
                property.estimatedValueCents === property.purchasePriceCents;
              const linked = contracts.filter(
                (c) =>
                  c.linkedPropertyId === property.id && c.status !== "closed",
              );

              return (
                <Card
                  key={property.id}
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
                  className="cursor-pointer p-5 transition-colors hover:border-[var(--border-sub)] hover:bg-[var(--surface-elevated)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                      <StatusBadge variant="calibrated" detail="Kaufpreis" />
                    ) : (
                      <StatusBadge variant="modeled" detail="Schätzwert" />
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
                        {formatCentsDE(summary?.linkedLoanBalanceCents ?? 0)}
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

      {/* Sektion: Verträge & Verbindlichkeiten */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Verträge &amp; Verbindlichkeiten
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {(
                [
                  { id: "all", label: "Alle" },
                  { id: "loan", label: "Kredite" },
                  { id: "savings_contract", label: "Sparverträge" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setCategoryFilter(option.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    categoryFilter === option.id
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {(
                [
                  { id: "all", label: "Alle Sphären" },
                  { id: "household", label: "Haushalt" },
                  { id: "personal", label: "Privat" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSphereFilter(option.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    sphereFilter === option.id
                      ? "bg-[var(--surface-elevated)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeAndPausedContracts.length === 0 ? (
          <Card className="border-dashed border-[var(--border-sub)] p-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Keine aktiven oder pausierten Verträge gefunden
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Erfasse Kredite, Privatdarlehen oder Bausparverträge ohne
                  hartcodierte Sonderfälle.
                </p>
              </div>
              <Button variant="secondary" onClick={openNewContractModal}>
                <Plus className="h-4 w-4" />
                Vertrag anlegen
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeAndPausedContracts.map((contract) => {
              const projection = projectionsById[contract.id];
              const isProjected = projection?.isProjected ?? false;
              const balanceCents =
                projection?.projectedBalanceCents ??
                contract.currentBalanceCents;
              const linkedProperty = contract.linkedPropertyId
                ? (propertyById.get(contract.linkedPropertyId) ?? null)
                : null;
              const nextMilestone = nextMilestoneByContractId.get(contract.id);
              const nextDate = nextMilestone?.date ?? null;
              const nextLabel = nextMilestone
                ? nextMilestone.kind === "milestone"
                  ? (contract.milestoneLabel?.trim() || "Meilenstein")
                  : nextMilestone.label
                : null;

              return (
                <Card
                  key={contract.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedContractId(contract.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedContractId(contract.id);
                    }
                  }}
                  className={`cursor-pointer p-5 transition-colors hover:bg-[var(--surface-elevated)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
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
                        <Badge variant="secondary">
                          {CONTRACT_SPHERE_LABELS[contract.sphere]}
                        </Badge>
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
                            detail={`Geeicht ${contract.balanceAsOfDate}`}
                          />
                        ) : (
                          <StatusBadge
                            variant="calibrated"
                            label="Geeicht"
                            detail={contract.balanceAsOfDate}
                          />
                        )}
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
                            {formatCentsDE(contract.monthlyRateCents)}/Monat
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
                              {nextDate}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-xs text-[var(--text-secondary)]">
                        {contract.category === "loan"
                          ? "Restschuld"
                          : "Guthaben"}
                      </p>
                      <p
                        className={`tabular-nums text-lg font-semibold ${
                          contract.category === "loan"
                            ? "text-[var(--rose)]"
                            : "text-[var(--sky)]"
                        }`}
                      >
                        {formatCentsDE(balanceCents)}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

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
              <span>Beendete Verträge ({closedContracts.length})</span>
            </button>

            {showClosed ? (
              <div className="mt-3 space-y-2">
                {closedContracts.map((contract) => (
                  <Card
                    key={contract.id}
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
      </section>

      <PropertyModal
        open={propertyModalOpen}
        onOpenChange={setPropertyModalOpen}
        initialProperty={editingProperty}
        onSaved={handleRefresh}
      />

      <ContractModal
        open={contractModalOpen}
        onOpenChange={setContractModalOpen}
        properties={properties}
        asOfDate={asOfDate}
        initialContract={editingContract}
        onSaved={handleRefresh}
      />

      <PropertyDetailDrawer
        property={selectedProperty}
        summary={
          selectedProperty
            ? (propertySummaries[selectedProperty.id] ?? null)
            : null
        }
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
