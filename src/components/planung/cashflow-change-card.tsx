"use client";

import * as React from "react";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCentsDE } from "@/lib/domain/money";
import { simulateCashflowChange } from "@/lib/domain/scenarios";
import type { DomainPot } from "@/lib/domain/waterfall";
import { SliderField } from "./euro-slider-field";
import { formatYearMonthDE } from "./format";

interface CashflowChangeCardProps {
  baseSurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: DomainPot[];
  startMonth: string;
}

function gainLabel(gained: number | null): string {
  if (gained === null) return "–";
  if (gained === 0) return "unverändert";
  const n = Math.abs(gained);
  return `${n} ${n === 1 ? "Monat" : "Monate"} ${gained > 0 ? "früher" : "später"}`;
}

export function CashflowChangeCard({
  baseSurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
  startMonth,
}: CashflowChangeCardProps) {
  const [deltaCents, setDeltaCents] = React.useState(50_000);
  const [fromMonth, setFromMonth] = React.useState(startMonth);
  const deferredDelta = React.useDeferredValue(deltaCents);

  const computed = React.useMemo(() => {
    try {
      return {
        ok: true as const,
        result: simulateCashflowChange({
          startMonth,
          baseMonthlySurplusCents: baseSurplusCents,
          change: { effectiveFromMonth: fromMonth, deltaMonthlyCents: deferredDelta },
          pots,
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof RangeError ? error.message : "Berechnung nicht möglich.",
      };
    }
  }, [startMonth, baseSurplusCents, fromMonth, deferredDelta, pots]);

  const result = computed.ok ? computed.result : null;
  const targetPots = result?.pots.filter((p) => p.hasTarget) ?? [];
  const hiddenCount = (result?.pots.length ?? 0) - targetPots.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gehaltssprung</CardTitle>
        <p className="text-sm text-[var(--text-secondary)]">
          Wann werden die Ziel-Töpfe voll, wenn sich der Monatsüberschuss ab einem Monat ändert?
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--text-secondary)]">Basis-Überschuss:</span>
          <span className="font-semibold tabular-nums">{formatCentsDE(baseSurplusCents)}</span>
          <span className="text-xs text-[var(--text-secondary)]">aus /allokation</span>
          {isDummy ? <StatusBadge variant="modeled" detail="Dummy-Daten" /> : null}
          {!hasHouseholdData ? (
            <StatusBadge variant="calibration_warning" label="Keine Haushaltsdaten" />
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <SliderField id="planung-delta" label="Änderung pro Monat" kind="euro" value={deltaCents} min={-100_000} max={200_000} step={5_000} onChange={setDeltaCents} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="planung-from" className="text-xs font-medium text-[var(--text-secondary)]">
              Gilt ab Monat
            </label>
            <input
              id="planung-from"
              type="month"
              value={fromMonth}
              min={startMonth}
              onChange={(e) => {
                if (/^\d{4}-\d{2}$/.test(e.target.value)) setFromMonth(e.target.value);
              }}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm tabular-nums"
            />
          </div>
        </div>

        {computed.ok === false ? (
          <p role="alert" className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            Eingabe ungültig: {computed.message}
          </p>
        ) : null}

        {result ? (
          <section aria-label="Ergebnis" className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--border-sub)] p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold tracking-tight">
                Neuer Überschuss:{" "}
                <span className="tabular-nums">{formatCentsDE(result.scenarioSurplusAfterChangeCents)}</span>
              </h3>
              <StatusBadge variant="modeled" />
            </div>

            {result.scenarioDeficitMonths > 0 ? (
              <p className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                Im Szenario ergibt sich in {result.scenarioDeficitMonths} Monaten ein Defizit – die Töpfe werden dann nicht gefüllt (keine Entnahme).
              </p>
            ) : null}

            {targetPots.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">Keine Töpfe mit Ziel vorhanden.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="bg-[var(--surface-elevated)] text-left text-xs text-[var(--text-secondary)]">
                      <th className="px-2 py-1.5 font-medium">Topf</th>
                      <th className="px-2 py-1.5 font-medium">Basis</th>
                      <th className="px-2 py-1.5 font-medium">Szenario</th>
                      <th className="px-2 py-1.5 font-medium">Effekt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetPots.map((p) => (
                      <tr key={p.potId} className="border-t border-[var(--border)]">
                        <td className="px-2 py-2">{p.potName}</td>
                        {p.alreadyFilled ? (
                          <td colSpan={3} className="px-2 py-2 text-[var(--emerald)]">bereits gefüllt</td>
                        ) : (
                          <>
                            <td className="px-2 py-2">
                              {p.baselineFillMonth ? formatYearMonthDE(p.baselineFillMonth) : "nicht im Horizont"}
                            </td>
                            <td className="px-2 py-2">
                              {p.scenarioFillMonth ? formatYearMonthDE(p.scenarioFillMonth) : "nicht im Horizont"}
                            </td>
                            <td className="px-2 py-2">{gainLabel(p.monthsGained)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hiddenCount > 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {hiddenCount} {hiddenCount === 1 ? "Topf" : "Töpfe"} ohne Ziel ausgeblendet.
              </p>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
