"use client";

import { RefreshCw } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { formatCentsDE } from "@/domain/core/money";
import { cn } from "@/frontend/ui/cn";
import { LegacyPlanItems } from "./legacy-plan-items";
import { SurplusFlowChart } from "./surplus-flow-chart";
import { InfoTip } from "@/frontend/ui/info-tip";
import {
  SEGMENT_TRACK, SegmentGroup, SegmentLabel, SegmentPill, segmentItemClass,
} from "@/frontend/ui/segmented";
import { type AllokationWorkspaceState } from "./use-allokation-workspace";

/** Kopfzahlen: Überschuss, Verteilung und Fristen im Überblick. */
export function AllocationOverview({ ws }: { ws: AllokationWorkspaceState }) {
  const {
    consolidatedSummary, deadlineRisk, handleSyncBridge, handleVariableBasisChange, householdData,
    isSyncingBridge, manualItems, monthlyPlan, potsConfigInvalid, router, setEditingPot,
    setPotModalOpen, surplusFlow, variableBasis, variableLabel,
  } = ws;
  return (
    <>
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
    </>
  );
}
