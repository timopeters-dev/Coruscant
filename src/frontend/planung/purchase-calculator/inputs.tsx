"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { formatCentsDE } from "@/domain/core/money";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/domain/planning/purchase-defaults";
import { SliderField } from "../euro-slider-field";
import { formatDateDE } from "@/domain/core/date-format";
import { Select } from "@/frontend/ui/select";
import { type PurchaseCalculatorState } from "./use-purchase-calculator";

/** Eingaben des Kaufrechners: Preis, Nebenkosten, Eigenkapital, Finanzierung, Miete. */
export function PurchaseCalculatorInputs({ ws }: { ws: PurchaseCalculatorState }) {
  const {
    equityAdoptedFromPot, form, handlePotChange, pots, ruleSetItemsByKey, selectedPotId,
    setEquityAdoptedFromPot, setForm,
  } = ws;
  return (
    <>
      {/* Eingaben */}
      <div className="flex flex-col gap-5 lg:col-span-6">
        <Card>
          <CardHeader>
            <CardTitle>Kaufpreis &amp; Eigenkapital</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <SliderField
              id="kp-price"
              label="Kaufpreis"
              kind="euro"
              value={form.purchasePriceCents}
              min={0}
              max={100_000_000}
              step={500_000}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, purchasePriceCents: v }))
              }
            />

            <div className="flex flex-col gap-2">
              <label
                htmlFor="kp-pot"
                className="text-xs font-medium text-[var(--text-secondary)]"
              >
                Eigenkapital-Topf (optional)
              </label>
              <Select
                id="kp-pot"
                value={selectedPotId}
                onChange={(e) => handlePotChange(e.target.value)}
              >
                <option value="">Kein Topf</option>
                {pots.map((pot) => (
                  <option key={pot.id} value={pot.id}>
                    {pot.name} ({formatCentsDE(pot.currentCents)})
                  </option>
                ))}
              </Select>
              {equityAdoptedFromPot ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  aus Topf „{equityAdoptedFromPot}“ übernommen
                </p>
              ) : null}
            </div>

            <SliderField
              id="kp-equity"
              label="Eingesetztes Eigenkapital"
              kind="euro"
              value={form.equityCents}
              min={0}
              max={50_000_000}
              step={100_000}
              onChange={(v) => {
                setEquityAdoptedFromPot(null);
                setForm((prev) => ({ ...prev, equityCents: v }));
              }}
            />

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={form.requireEquityCoversCosts}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    requireEquityCoversCosts: e.target.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-[var(--text-primary)]">
                  Eigenkapital deckt mindestens die Nebenkosten
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  Üblich bei Bankfinanzierungen; ohne Schalter wird eine Vollfinanzierung inkl. Nebenkosten gerechnet.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Finanzierung</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <SliderField
              id="kp-interest"
              label="Sollzinssatz p. a."
              kind="percent"
              value={form.interestRateBps}
              min={0}
              max={1_000}
              step={5}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, interestRateBps: v }))
              }
            />
            <SliderField
              id="kp-repayment"
              label="Anfängliche Tilgung p. a."
              kind="percent"
              value={form.initialRepaymentBps}
              min={0}
              max={1_000}
              step={5}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, initialRepaymentBps: v }))
              }
            />
            <SliderField
              id="kp-years"
              label="Zinsbindung"
              kind="years"
              value={form.fixedRateYears}
              min={1}
              max={40}
              step={1}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, fixedRateYears: v }))
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Miete &amp; laufende Objektkosten</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <SliderField
              id="kp-rent"
              label="Monatliche Kaltmiete"
              kind="euro"
              value={form.monthlyColdRentCents}
              min={0}
              max={500_000}
              step={5_000}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, monthlyColdRentCents: v }))
              }
            />
            <SliderField
              id="kp-nonrec"
              label="Nicht umlagefähige Kosten / Monat"
              kind="euro"
              value={form.monthlyNonRecoverableCostsCents}
              min={0}
              max={100_000}
              step={1_000}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  monthlyNonRecoverableCostsCents: v,
                }))
              }
            />
            <SliderField
              id="kp-maint"
              label="Instandhaltungsrücklage / Monat"
              kind="euro"
              value={form.monthlyMaintenanceCents}
              min={0}
              max={100_000}
              step={1_000}
              hint="Faustregel je nach Baujahr/Zustand: ca. 1,00 €/m² im Monat (manuell als Monatsbetrag angesetzt)."
              onChange={(v) =>
                setForm((prev) => ({ ...prev, monthlyMaintenanceCents: v }))
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kaufnebenkosten</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {form.costItems.map((item, idx) => (
              <SliderField
                key={item.key}
                id={`kp-cost-${item.key}`}
                label={item.label}
                kind="percent"
                value={item.bps}
                min={0}
                max={1_000}
                step={5}
                hint={ruleSetItemsByKey.get(item.key)?.hint}
                onChange={(bps) =>
                  setForm((prev) => ({
                    ...prev,
                    costItems: prev.costItems.map((entry, i) =>
                      i === idx ? { ...entry, bps } : entry,
                    ),
                  }))
                }
              />
            ))}
            <p className="text-xs text-[var(--text-secondary)]">
              Richtwerte, Stand{" "}
              <span className="tabular-nums">
                {formatDateDE(CURRENT_PURCHASE_COST_RULE_SET.reviewedAt)}
              </span>
              , regional abhängig – bitte mit Exposé und Notar prüfen.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
