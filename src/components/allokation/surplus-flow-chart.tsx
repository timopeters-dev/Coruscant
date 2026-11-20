"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { ChartLegend } from "@/components/charts/chart-legend";
import {
  CHART_ROLE_COLOR,
  type ChartRole,
} from "@/components/charts/chart-tokens";
import { formatCentsDE } from "@/lib/domain/money";
import type { summarizeDeadlineRisks } from "@/lib/domain/pot-deadline";
import type {
  FlowInflowKind,
  FlowProvenance,
  FlowStepKind,
  SurplusFlow,
} from "@/lib/domain/surplus-flow";
import type { WaterfallPlan } from "@/lib/domain/waterfall";
import { cn } from "@/lib/utils";

interface SurplusFlowChartProps {
  flow: SurplusFlow;
  plan: WaterfallPlan | null;
  isDummy: boolean;
  hasHouseholdData: boolean;
  variableLabel: string;
  deadlineRisk: ReturnType<typeof summarizeDeadlineRisks> | null;
  potsConfigInvalid: boolean;
  onCreatePot: () => void;
}

const INFLOW_LABELS: Record<FlowInflowKind, string> = {
  household: "Gehälter (Gemeinschaftskonto)",
  property_rent: "Mieteinnahmen",
  manual_in: "Weitere Posten (Einnahmen)",
};

function stepLabel(kind: FlowStepKind, variableLabel: string): string {
  switch (kind) {
    case "fixed":
      return "Fixkosten";
    case "variable":
      return `Variable (${variableLabel})`;
    case "contracts":
      return "Vertragsraten";
    case "property_costs":
      return "Objektkosten";
    case "manual_out":
      return "Weitere Posten";
  }
}

function segmentStyle(
  role: ChartRole,
  provenance: FlowProvenance,
): React.CSSProperties {
  const color = CHART_ROLE_COLOR[role];
  return provenance === "calibrated"
    ? { backgroundColor: color, borderColor: color }
    : {
        backgroundColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        borderColor: color,
      };
}

function Track({
  children,
  zeroBps,
}: {
  children: React.ReactNode;
  zeroBps: number | null;
}) {
  return (
    <div className="reveal-x relative h-5 w-full rounded-md bg-[var(--surface-elevated)]/50">
      {zeroBps !== null ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-[var(--border-sub)]"
          style={{ left: `${zeroBps / 100}%` }}
        />
      ) : null}
      {children}
    </div>
  );
}

function Row({
  label,
  amount,
  amountClass,
  children,
}: {
  label: string;
  amount: string;
  amountClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr_6.5rem]">
      <span className="truncate text-xs text-[var(--text-secondary)] sm:col-start-1">
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums text-right text-xs font-semibold sm:order-3",
          amountClass,
        )}
      >
        {amount}
      </span>
      <div className="col-span-2 sm:order-2 sm:col-span-1">{children}</div>
    </div>
  );
}

export function SurplusFlowChart({
  flow,
  plan,
  isDummy,
  hasHouseholdData,
  variableLabel,
  deadlineRisk,
  potsConfigInvalid,
  onCreatePot,
}: SurplusFlowChartProps) {
  if (flow.status === "no_data") {
    return (
      <Card className="border-dashed border-[var(--border-sub)]">
        <CardContent className="space-y-1 py-5">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Überschuss-Fluss
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            Noch keine Zahlen für den Fluss. Sobald das Gemeinschaftskonto
            synchronisiert ist, zeigt dieses Diagramm, wie Einnahmen über Fix-
            und variable Kosten zum Überschuss und in die Töpfe fließen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isDeficit = flow.status === "deficit";
  const zeroBps = flow.scaleMinCents < 0 ? flow.inflowBarBps.fromBps : null;
  const proposedCents = flow.pots
    .filter((p) => p.kind !== "unallocated")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const proposedPotCount = flow.pots
    .filter((p) => p.kind !== "unallocated")
    .reduce((sum, p) => sum + p.potIds.length, 0);

  const surplusAmountLabel = isDeficit
    ? `Unterdeckung ${formatCentsDE(flow.surplusCents)}`
    : formatCentsDE(flow.surplusCents, { showPlusSign: flow.surplusCents > 0 });

  const ariaLabel =
    `Einnahmen ${formatCentsDE(flow.totalInflowCents)}, Abzüge ${formatCentsDE(flow.totalOutflowCents)}, ` +
    (isDeficit
      ? `Unterdeckung ${formatCentsDE(Math.abs(flow.surplusCents))}.`
      : `Überschuss ${formatCentsDE(flow.surplusCents)}` +
        (proposedPotCount > 0
          ? `, davon ${formatCentsDE(proposedCents)} auf ${proposedPotCount} ${proposedPotCount === 1 ? "Topf" : "Töpfe"} vorgeschlagen.`
          : "."));

  const inflowSegments = flow.inflows.map((seg, index) => ({
    seg,
    left:
      flow.inflowBarBps.fromBps +
      flow.inflows.slice(0, index).reduce((sum, x) => sum + x.widthBps, 0),
  }));

  const tableRows: Array<Record<string, React.ReactNode>> = [
    ...flow.inflows.map((i) => ({
      item: INFLOW_LABELS[i.kind],
      amount: `+${formatCentsDE(i.amountCents)}`,
      origin: i.provenance === "calibrated" ? "Geeicht" : "Modelliert",
    })),
    ...flow.steps.map((s) => ({
      item: stepLabel(s.kind, variableLabel),
      amount: `−${formatCentsDE(s.amountCents)}`,
      origin: s.provenance === "calibrated" ? "Geeicht" : "Modelliert",
    })),
    {
      item: isDeficit ? "Unterdeckung" : "Überschuss",
      amount: formatCentsDE(flow.surplusCents),
      origin: flow.surplusProvenance === "calibrated" ? "Geeicht" : "Modelliert",
    },
  ];
  if (flow.status === "surplus" && plan !== null) {
    for (const s of plan.suggestions) {
      if (s.allocatedCents > 0) {
        tableRows.push({
          item: `#${s.priority} ${s.potName}`,
          amount: formatCentsDE(s.allocatedCents),
          origin: "Modelliert (Vorschlag)",
        });
      }
    }
    if (plan.unallocatedCents > 0) {
      tableRows.push({
        item: "Nicht verteilt",
        amount: formatCentsDE(plan.unallocatedCents),
        origin: "Modelliert (Vorschlag)",
      });
    }
  }

  return (
    <Card
      className={cn(
        flow.surplusProvenance === "modeled" &&
          "border-dashed border-[var(--border-sub)]",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Überschuss-Fluss</CardTitle>
          {isDummy ? (
            <StatusBadge
              variant="modeled"
              label="Dev-Vorschau"
              detail="Dummy-Daten"
            />
          ) : (
            <StatusBadge
              variant={
                flow.surplusProvenance === "calibrated" ? "calibrated" : "modeled"
              }
            />
          )}
        </div>
        {!hasHouseholdData ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {flow.hasManualItems
              ? "Ohne Gemeinschaftskonto – Verträge, Objekte und weitere Posten"
              : "Ohne Gemeinschaftskonto – nur Verträge und Objekte"}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="img" aria-label={ariaLabel} className="space-y-2.5">
          <Row
            label="Einnahmen"
            amount={`+${formatCentsDE(flow.totalInflowCents)}`}
            amountClass="text-[var(--emerald)]"
          >
            <Track zeroBps={zeroBps}>
              {inflowSegments.map(({ seg, left }) => (
                <span
                  key={seg.kind}
                  title={`${INFLOW_LABELS[seg.kind]}: ${formatCentsDE(seg.amountCents)}`}
                  className={cn(
                    "absolute inset-y-0 border",
                    seg.provenance === "modeled" && "border-dashed",
                  )}
                  style={{
                    left: `${left / 100}%`,
                    width: `${seg.widthBps / 100}%`,
                    ...segmentStyle("inflow", seg.provenance),
                  }}
                />
              ))}
            </Track>
          </Row>

          {flow.steps.map((step) => (
            <Row
              key={step.kind}
              label={stepLabel(step.kind, variableLabel)}
              amount={`−${formatCentsDE(step.amountCents)}`}
              amountClass="text-[var(--rose)]"
            >
              <Track zeroBps={zeroBps}>
                <span
                  className={cn(
                    "absolute inset-y-0 border",
                    step.provenance === "modeled" && "border-dashed",
                  )}
                  style={{
                    left: `${step.fromBps / 100}%`,
                    width: `${(step.toBps - step.fromBps) / 100}%`,
                    ...segmentStyle("outflow", step.provenance),
                  }}
                />
              </Track>
            </Row>
          ))}

          <Row
            label={isDeficit ? "Unterdeckung" : "Überschuss"}
            amount={surplusAmountLabel}
            amountClass={
              isDeficit ? "text-[var(--rose)]" : "text-[var(--emerald)]"
            }
          >
            <Track zeroBps={zeroBps}>
              <span
                className={cn(
                  "absolute inset-y-0 border",
                  flow.surplusProvenance === "modeled" && "border-dashed",
                )}
                style={{
                  left: `${flow.surplusBarBps.fromBps / 100}%`,
                  width: `${(flow.surplusBarBps.toBps - flow.surplusBarBps.fromBps) / 100}%`,
                  minWidth: "2px",
                  ...segmentStyle(
                    isDeficit ? "deficit" : "surplus",
                    flow.surplusProvenance,
                  ),
                }}
              />
            </Track>
          </Row>
        </div>

        <div className="space-y-2.5">
          <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 border-t border-dashed border-[var(--border)] pt-2.5 sm:grid-cols-[8rem_1fr_6.5rem]">
            <span className="text-xs text-[var(--text-secondary)]">Töpfe</span>
            <div className="min-w-0 space-y-1.5 sm:col-start-2">
              <StatusBadge
                variant="modeled"
                detail="Vorschlag dieses Monats"
                className="max-w-full"
              />
              {flow.status === "zero" ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Kein Überschuss zum Verteilen.
                </p>
              ) : isDeficit ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Bei Unterdeckung wird nichts auf Töpfe verteilt.
                </p>
              ) : potsConfigInvalid ? (
                <p className="text-xs text-[var(--amber)]">
                  Vorschlag nicht berechenbar – Topf-Regeln prüfen (z. B.
                  Restverteilung über 100 %).
                </p>
              ) : !flow.potsAvailable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-[var(--text-secondary)]">
                    Noch keine Ziel-Töpfe – der ganze Überschuss ist frei.
                  </p>
                  <Button variant="ghost" size="sm" onClick={onCreatePot}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Topf anlegen
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="reveal-x flex h-5 w-full gap-[2px] overflow-hidden rounded-md">
                    {flow.pots.map((p) => (
                      <span
                        key={p.key}
                        title={`${p.label} · ${formatCentsDE(p.amountCents)}`}
                        className="h-full border border-dashed"
                        style={{
                          width: `${p.widthBps / 100}%`,
                          ...segmentStyle(
                            p.kind === "unallocated" ? "unallocated" : "pot",
                            "modeled",
                          ),
                        }}
                      />
                    ))}
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {flow.pots.map((p) => (
                      <li
                        key={p.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]">
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-2 shrink-0 rounded-sm border border-dashed"
                            style={segmentStyle(
                              p.kind === "unallocated" ? "unallocated" : "pot",
                              "modeled",
                            )}
                          />
                          <span className="truncate">{p.label}</span>
                        </span>
                        <span className="tabular-nums shrink-0 font-medium text-[var(--text-primary)]">
                          {formatCentsDE(p.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {deadlineRisk && deadlineRisk.atRiskCount > 0 && deadlineRisk.worst ? (
          <p className="text-xs text-[var(--rose)]">
            {deadlineRisk.atRiskCount === 1
              ? "1 Topf verfehlt seinen Zieltermin"
              : `${deadlineRisk.atRiskCount} Töpfe verfehlen ihren Zieltermin`}
            : {deadlineRisk.worst.potName}
          </p>
        ) : deadlineRisk && deadlineRisk.overdueCount > 0 && deadlineRisk.worst ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Termin verstrichen: {deadlineRisk.worst.potName}
          </p>
        ) : null}

        <ChartLegend
          items={[
            { role: "inflow", label: "Geeicht" },
            { role: "inflow", dashed: true, label: "Modelliert" },
          ]}
        />
        <ChartDataTable
          columns={[
            { key: "item", header: "Posten" },
            { key: "amount", header: "Betrag / Monat", align: "right" },
            { key: "origin", header: "Herkunft" },
          ]}
          rows={tableRows}
        />
      </CardContent>
    </Card>
  );
}
