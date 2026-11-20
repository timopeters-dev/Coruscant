"use client";

import * as React from "react";
import { ChartDataTable } from "@/frontend/charts/chart-data-table";
import { ChartLegend } from "@/frontend/charts/chart-legend";
import { LineChart } from "@/frontend/charts/line-chart";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { Dialog } from "@/frontend/ui/dialog";
import { InfoTip } from "@/frontend/ui/info-tip";
import { Input } from "@/frontend/ui/input";
import { Link as LinkIcon } from "lucide-react";
import { Select } from "@/frontend/ui/select";
import { centsToEuroInputString, formatBpsDE, parseEuroInputToCents } from "@/domain/core/money";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/domain/planning/purchase-defaults";
import { formatWholeEuroDE } from "@/frontend/charts/chart-scale";
import { totalSaleCostsBps } from "@/domain/planning/property-vs-etf-tax";
import { ALLOWED_CHURCH_TAX_BPS } from "@/domain/planning/scenarios";
import { cn } from "@/frontend/ui/cn";
import { SliderField } from "./euro-slider-field";
import {
  describeBreakEven,
  describeFinancing,
  describeInitialCashflow,
  describeKpiBasis,
  toPropertyVsEtfChart,
  toPropertyVsEtfKpis,
  type PropertyVsEtfKpi,
} from "./property-vs-etf-chart-data";
import { PROPERTY_VS_ETF_FIELD_INFO } from "./property-vs-etf-field-info";
import { buildPropertyVsEtfExplanation } from "./property-vs-etf-explanation";
import {
  evaluatePropertyVsEtf,
  FORM_ERROR_KEY,
  isAssumptionsModified,
  isTaxModified,
  nextLastOk,
  parseSqmInputToCentiSqm,
  PROPERTY_VS_ETF_UI_SLIDERS,
  resolveEquity,
  type NumericFieldKey,
  type PropertyVsEtfAction,
  type PropertyVsEtfEvaluation,
  type PropertyVsEtfFormState,
  type SliderFieldKey,
} from "./property-vs-etf-state";

type OkEvaluation = Extract<PropertyVsEtfEvaluation, { status: "ok" }>;

const MISSING_LABELS = {
  purchasePrice: "Kaufpreis",
  livingArea: "Wohnfläche",
  coldRent: "Kaltmiete pro qm",
} as const;

const KPI_PLACEHOLDERS: Array<Pick<PropertyVsEtfKpi, "key" | "label">> = [
  { key: "property", label: "Immobilien-Vermögen" },
  { key: "etf", label: "ETF-Vermögen" },
  { key: "advantage", label: "Immobilien-Vorteil" },
];

const KPI_TONE_CLASS: Record<PropertyVsEtfKpi["tone"], string> = {
  bound: "text-[var(--sky)]",
  accent: "text-[var(--accent)]",
  positive: "text-[var(--emerald)]",
  negative: "text-[var(--rose)]",
  neutral: "text-[var(--text-primary)]",
};

const CHURCH_TAX_LABEL: Record<number, string> = {
  0: "keine",
  800: "8 %",
  900: "9 %",
};

interface NumberFieldProps {
  id: string;
  label: string;
  value: number | null;
  kind: "euro" | "sqm";
  onChange: (value: number | null) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Erklärtext (Info-Symbol neben dem Label). */
  info?: string;
}

/** Zahlenfeld für Beträge/Flächen auf ganzzahligen Cent bzw. Hundertstel-qm. */
function NumberField({
  id,
  label,
  value,
  kind,
  onChange,
  placeholder,
  hint,
  error,
  disabled = false,
  autoFocus = false,
  info,
}: NumberFieldProps) {
  const parse = kind === "sqm" ? parseSqmInputToCentiSqm : parseEuroInputToCents;
  const [draft, setDraft] = React.useState<string | null>(null);
  const parsedDraft = draft === null ? null : parse(draft);
  const draftIsStale = draft !== null && parsedDraft !== null && parsedDraft !== value;
  const formatted = value === null ? "" : centsToEuroInputString(value);
  const text = draft !== null && !draftIsStale ? draft : formatted;
  const nonEmptyInvalid = draft !== null && draft.trim() !== "" && parsedDraft === null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
        </label>
        {info ? <InfoTip label={label} text={info} id={`${id}-info`} /> : null}
      </div>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          hasError={nonEmptyInvalid || Boolean(error)}
          className="pr-9 text-right tabular-nums"
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw.trim() === "") {
              onChange(null);
              return;
            }
            const parsed = parse(raw);
            if (parsed !== null) onChange(parsed);
          }}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)]">
          {kind === "sqm" ? "qm" : "€"}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-xs text-[var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

interface WorkbenchProps {
  state: PropertyVsEtfFormState;
  dispatch: React.Dispatch<PropertyVsEtfAction>;
  /** Herkunft der Vorbelegung (nur für den Hinweis im Leerzustand). */
  origin?: "kaufrechner" | null;
  /** Ohne diese Prop gibt es keinen „Link kopieren“-Button. */
  onCopyLink?: () => Promise<{ copied: boolean; url: string }>;
}

function ExplanationDetails({ shown }: { shown: OkEvaluation }) {
  const sections = React.useMemo(
    () => buildPropertyVsEtfExplanation(shown),
    [shown],
  );
  return (
    <details className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        Wie wurde gerechnet?
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold text-[var(--text-primary)]">
              {section.title}
            </h4>
            <dl className="flex flex-col gap-1">
              {section.items.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-wrap justify-between gap-x-4 gap-y-0.5"
                >
                  <dt className="text-[var(--text-secondary)]">{item.label}</dt>
                  <dd className="text-right tabular-nums">{item.value}</dd>
                </div>
              ))}
            </dl>
            {section.note ? (
              <p className="text-[var(--text-secondary)]">{section.note}</p>
            ) : null}
          </section>
        ))}
      </div>
    </details>
  );
}

function CopyLinkControl({
  onCopyLink,
}: {
  onCopyLink: () => Promise<{ copied: boolean; url: string }>;
}) {
  const [status, setStatus] = React.useState<{
    copied: boolean;
    url: string;
  } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => setStatus(await onCopyLink())}
      >
        <LinkIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Link kopieren
      </Button>
      {status ? (
        <div role="status" className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          {status.copied ? (
            <span>Link kopiert</span>
          ) : (
            <>
              <span>Kopieren nicht möglich – Link markieren und kopieren:</span>
              <input
                readOnly
                value={status.url}
                aria-label="Link"
                onFocus={(e) => e.currentTarget.select()}
                className="w-72 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ModifiedSuffix({ modified }: { modified: boolean }) {
  return modified ? (
    <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">
      (angepasst)
    </span>
  ) : null;
}

export function costRuleHint(purchaseCostsCents: number | null): string {
  const ruleSet = CURRENT_PURCHASE_COST_RULE_SET;
  const items = ruleSet.items
    .map((item) => `${item.label} ${formatBpsDE(item.bps)} (${item.hint})`)
    .join(" · ");
  const parts = [items, ruleSet.note];
  if (purchaseCostsCents !== null) {
    parts.push(`= ${formatWholeEuroDE(purchaseCostsCents)}`);
  }
  return parts.join(" ");
}

export function PropertyVsEtfWorkbench({
  state,
  dispatch,
  origin = null,
  onCopyLink,
}: WorkbenchProps) {
  const baseId = React.useId();
  const fid = (key: string) => `${baseId}-${key}`;

  const deferred = React.useDeferredValue(state);
  const isStale = state !== deferred;
  const evaluation = React.useMemo(
    () => evaluatePropertyVsEtf(deferred),
    [deferred],
  );

  // Letztes gültiges Ergebnis merken (Render-Phase-Update statt Ref-Schreiben).
  const [lastOk, setLastOk] = React.useState<OkEvaluation | null>(null);
  const shown = nextLastOk(lastOk, evaluation);
  if (shown !== lastOk) {
    setLastOk(shown);
  }
  const dimmed = evaluation.status === "invalid" && shown !== null;

  const chart = React.useMemo(
    () => (shown ? toPropertyVsEtfChart(shown.result) : null),
    [shown],
  );
  const kpis = React.useMemo(
    () => (shown ? toPropertyVsEtfKpis(shown.result) : null),
    [shown],
  );

  const errors: Partial<Record<string, string>> =
    evaluation.status === "invalid" ? evaluation.fieldErrors : {};
  const equity = React.useMemo(() => resolveEquity(deferred), [deferred]);
  const taxOn = state.tax.taxesEnabled;
  // Summe kommt aus der Domäne; außerhalb der Grenzen wird die Zeile ausgeblendet.
  let saleCostsTotalText: string | null = null;
  try {
    saleCostsTotalText = formatBpsDE(totalSaleCostsBps(state.tax));
  } catch {
    saleCostsTotalText = null;
  }
  const assumptionsModified = isAssumptionsModified(state);
  const taxModified = isTaxModified(state);

  const slider = (
    key: SliderFieldKey,
    label: string,
    value: number,
    kind: "percent" | "years",
    onChange: (v: number) => void,
    extra?: { hint?: string; disabled?: boolean; allowNegative?: boolean; error?: string },
  ) => {
    const range = PROPERTY_VS_ETF_UI_SLIDERS[key];
    return (
      <SliderField
        id={fid(key)}
        label={label}
        value={value}
        min={range.min}
        max={range.max}
        step={range.step}
        kind={kind}
        onChange={onChange}
        hint={extra?.hint}
        disabled={extra?.disabled}
        allowNegative={extra?.allowNegative}
        error={extra?.error ?? errors[key]}
        info={PROPERTY_VS_ETF_FIELD_INFO[key]}
      />
    );
  };

  const setField = (field: NumericFieldKey) => (value: number | null) =>
    dispatch({ type: "setField", field, value });

  const setTax =
    (field: Extract<PropertyVsEtfAction, { type: "setTaxField" }>["field"]) =>
    (value: number) =>
      dispatch({ type: "setTaxField", field, value });

  const equityValue =
    state.equityMode === "manual"
      ? state.manualEquityCents
      : equity !== null
        ? equity.effectiveCents
        : null;

  const clampHint =
    equity === null || state.equityMode !== "manual"
      ? null
      : equity.clamped === "raised_to_costs"
        ? "auf die Kaufnebenkosten angehoben"
        : equity.clamped === "lowered_to_total"
          ? "auf Kaufpreis plus Nebenkosten begrenzt"
          : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* DOM-Reihenfolge: Eingaben zuerst (Tab-Reihenfolge); mobil steht das Ergebnis oben. */}
        <div className="order-last flex flex-col gap-5 lg:order-first">
          <section aria-labelledby={fid("object")} className="flex flex-col gap-4">
            <h3 id={fid("object")} className="text-sm font-semibold tracking-tight">
              Objekt
            </h3>
            <NumberField
              id={fid("purchasePrice")}
              info={PROPERTY_VS_ETF_FIELD_INFO.purchasePriceCents}
              label="Kaufpreis"
              kind="euro"
              value={state.purchasePriceCents}
              placeholder="z. B. 250.000"
              autoFocus
              error={errors.purchasePriceCents}
              onChange={setField("purchasePriceCents")}
            />
            <NumberField
              id={fid("livingArea")}
              info={PROPERTY_VS_ETF_FIELD_INFO.livingAreaCentiSqm}
              label="Wohnfläche"
              kind="sqm"
              value={state.livingAreaCentiSqm}
              placeholder="z. B. 70"
              error={errors.livingAreaCentiSqm}
              onChange={setField("livingAreaCentiSqm")}
            />
            <NumberField
              id={fid("coldRent")}
              info={PROPERTY_VS_ETF_FIELD_INFO.coldRentPerSqmCents}
              label="Kaltmiete pro qm"
              kind="euro"
              value={state.coldRentPerSqmCents}
              placeholder="z. B. 12"
              error={errors.coldRentPerSqmCents}
              onChange={setField("coldRentPerSqmCents")}
            />
            {slider(
              "purchaseCostsBps",
              "Kaufnebenkosten",
              state.purchaseCostsBps,
              "percent",
              (v) => dispatch({ type: "setField", field: "purchaseCostsBps", value: v }),
              { hint: costRuleHint(equity?.purchaseCostsCents ?? null) },
            )}
            <div className="flex flex-col gap-1.5">
              <NumberField
                id={fid("equity")}
                info={PROPERTY_VS_ETF_FIELD_INFO.equityCents}
                label="Eigenkapital"
                kind="euro"
                value={equityValue}
                placeholder="folgt den Nebenkosten"
                error={errors.equityCents}
                hint={
                  equity !== null
                    ? `mind. ${formatWholeEuroDE(equity.minCents)}, höchstens ${formatWholeEuroDE(equity.maxCents)} (Gesamtkosten)`
                    : undefined
                }
                onChange={(v) => dispatch({ type: "setEquity", value: v ?? 0 })}
              />
              {clampHint ? (
                <p className="text-xs text-[var(--amber)]">{clampHint}</p>
              ) : null}
              {state.equityMode === "manual" ? (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "resetEquityToCosts" })}
                  className="self-start text-xs font-medium text-[var(--text-secondary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:text-[var(--accent)]"
                >
                  Auf Nebenkosten zurücksetzen
                </button>
              ) : null}
            </div>
          </section>

          <details className="rounded-lg border border-[var(--border)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Annahmen
              <ModifiedSuffix modified={assumptionsModified} />
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <button
                type="button"
                onClick={() => dispatch({ type: "resetAssumptions" })}
                className="self-start text-xs font-medium text-[var(--text-secondary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:text-[var(--accent)]"
              >
                Standardwerte
              </button>
              {slider("interestRateBps", "Darlehenszins", state.interestRateBps, "percent", (v) =>
                dispatch({ type: "setField", field: "interestRateBps", value: v }),
              )}
              {slider(
                "initialRepaymentBps",
                "Anfängliche Tilgung",
                state.initialRepaymentBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "initialRepaymentBps", value: v }),
              )}
              {slider(
                "rentGrowthBps",
                "Mietsteigerung",
                state.rentGrowthBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "rentGrowthBps", value: v }),
                { allowNegative: true },
              )}
              {slider(
                "valueGrowthBps",
                "Wertsteigerung",
                state.valueGrowthBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "valueGrowthBps", value: v }),
                { allowNegative: true },
              )}
              {slider(
                "costGrowthBps",
                "Kostensteigerung (WEG)",
                state.costGrowthBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "costGrowthBps", value: v }),
                { allowNegative: true },
              )}
              {slider("vacancyBps", "Mietausfallwagnis", state.vacancyBps, "percent", (v) =>
                dispatch({ type: "setField", field: "vacancyBps", value: v }),
              )}
              <NumberField
                id={fid("hoa")}
                info={PROPERTY_VS_ETF_FIELD_INFO.monthlyHoaCostsCents}
                label="WEG-Kosten pro Monat (nicht umlagefähig)"
                kind="euro"
                value={state.monthlyHoaCostsCents}
                error={errors.monthlyHoaCostsCents}
                onChange={(v) =>
                  dispatch({ type: "setField", field: "monthlyHoaCostsCents", value: v ?? 0 })
                }
              />
              {slider(
                "maintenanceReserveBps",
                "Instandhaltungsrücklage (p. a. vom Wert)",
                state.maintenanceReserveBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "maintenanceReserveBps", value: v }),
              )}
              {slider(
                "etfAnnualReturnBps",
                "ETF-Rendite (p. a.)",
                state.etfAnnualReturnBps,
                "percent",
                (v) => dispatch({ type: "setField", field: "etfAnnualReturnBps", value: v }),
                { allowNegative: true },
              )}
              <div className="flex items-center gap-1">
                <label
                  htmlFor={fid("reinvestSurplus")}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <input
                    id={fid("reinvestSurplus")}
                    type="checkbox"
                    role="switch"
                    aria-checked={state.reinvestSurplus}
                    checked={state.reinvestSurplus}
                    onChange={(e) =>
                      dispatch({ type: "setReinvestSurplus", value: e.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Positiven Cashflow im ETF anlegen
                </label>
                <InfoTip
                  label="Positiven Cashflow im ETF anlegen"
                  text={PROPERTY_VS_ETF_FIELD_INFO.reinvestSurplus}
                  id={`${fid("reinvestSurplus")}-info`}
                />
              </div>
              {slider("horizonYears", "Anlagehorizont", state.horizonYears, "years", (v) =>
                dispatch({ type: "setField", field: "horizonYears", value: v }),
              )}
            </div>
          </details>

          <details className="rounded-lg border border-[var(--border)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Steuern &amp; Verkauf
              <ModifiedSuffix modified={taxModified} />
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                <label
                  htmlFor={fid("taxesEnabled")}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <input
                    id={fid("taxesEnabled")}
                    type="checkbox"
                    role="switch"
                    aria-checked={taxOn}
                    checked={taxOn}
                    onChange={(e) =>
                      dispatch({ type: "setTaxesEnabled", value: e.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Steuern berücksichtigen
                </label>
                <InfoTip
                  label="Steuern berücksichtigen"
                  text={PROPERTY_VS_ETF_FIELD_INFO.taxesEnabled}
                  id={`${fid("taxesEnabled")}-info`}
                />
                </div>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "resetTaxes" })}
                  className="text-xs font-medium text-[var(--text-secondary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:text-[var(--accent)]"
                >
                  Standardwerte
                </button>
              </div>
              {!taxOn ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Verkaufskosten wirken auch ohne Steuern.
                </p>
              ) : null}
              {slider(
                "marginalTaxRateBps",
                "Grenzsteuersatz",
                state.tax.marginalTaxRateBps,
                "percent",
                setTax("marginalTaxRateBps"),
                { disabled: !taxOn },
              )}
              {slider(
                "depreciationRateBps",
                "AfA-Satz",
                state.tax.depreciationRateBps,
                "percent",
                setTax("depreciationRateBps"),
                { disabled: !taxOn },
              )}
              {slider(
                "buildingShareBps",
                "Gebäudeanteil",
                state.tax.buildingShareBps,
                "percent",
                setTax("buildingShareBps"),
                { disabled: !taxOn },
              )}
              {slider(
                "speculationPeriodYears",
                "Spekulationsfrist",
                state.tax.speculationPeriodYears,
                "years",
                setTax("speculationPeriodYears"),
                { disabled: !taxOn },
              )}
              {slider(
                "reserveDeductionLagYears",
                "Rücklage wird verwendet nach",
                state.tax.reserveDeductionLagYears,
                "years",
                setTax("reserveDeductionLagYears"),
                { disabled: !taxOn },
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label
                    htmlFor={fid("churchTax")}
                    className="text-xs font-medium text-[var(--text-secondary)]"
                  >
                    Kirchensteuer
                  </label>
                  <InfoTip
                    label="Kirchensteuer"
                    text={PROPERTY_VS_ETF_FIELD_INFO.churchTaxBps}
                    id={`${fid("churchTax")}-info`}
                  />
                </div>
                <Select
                  id={fid("churchTax")}
                  disabled={!taxOn}
                  value={String(state.tax.churchTaxBps)}
                  hasError={Boolean(errors.churchTaxBps)}
                  onChange={(e) => setTax("churchTaxBps")(Number(e.target.value))}
                >
                  {ALLOWED_CHURCH_TAX_BPS.map((bps) => (
                    <option key={bps} value={bps}>
                      {CHURCH_TAX_LABEL[bps] ?? formatBpsDE(bps)}
                    </option>
                  ))}
                </Select>
                {errors.churchTaxBps ? (
                  <p role="alert" className="text-xs text-[var(--rose)]">
                    {errors.churchTaxBps}
                  </p>
                ) : null}
              </div>
              {slider(
                "partialExemptionBps",
                "Teilfreistellung (ETF)",
                state.tax.partialExemptionBps,
                "percent",
                setTax("partialExemptionBps"),
                { disabled: !taxOn },
              )}
              <NumberField
                id={fid("saverAllowance")}
                info={PROPERTY_VS_ETF_FIELD_INFO.saverAllowanceCents}
                label="Sparerpauschbetrag"
                kind="euro"
                value={state.tax.saverAllowanceCents}
                disabled={!taxOn}
                error={errors.saverAllowanceCents}
                onChange={(v) => setTax("saverAllowanceCents")(v ?? 0)}
              />
              <p className="text-xs text-[var(--text-secondary)]">
                Kapitalertragsteuer inkl. Soli: 26,375 % (fest)
              </p>
              {slider(
                "brokerFeeBps",
                "Maklerprovision (Verkäufer)",
                state.tax.brokerFeeBps,
                "percent",
                setTax("brokerFeeBps"),
              )}
              {slider(
                "otherSaleCostsBps",
                "Sonstige Verkaufskosten",
                state.tax.otherSaleCostsBps,
                "percent",
                setTax("otherSaleCostsBps"),
              )}
              {saleCostsTotalText !== null ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Verkaufskosten gesamt: {saleCostsTotalText}
                </p>
              ) : null}
            </div>
          </details>
        </div>

        <section
          aria-label="Ergebnis"
          aria-busy={isStale}
          className={cn(
            "order-first flex flex-col gap-4 self-start rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface)] p-5 transition-opacity lg:sticky lg:top-0 lg:order-last",
            isStale && "opacity-70",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">
              Ergebnis
            </h3>
            <StatusBadge variant="modeled" />
          </div>

          {shown && chart && kpis ? (
            <div className={cn("flex flex-col gap-4", dimmed && "opacity-60")}>
              {dimmed ? (
                <p role="status" className="text-xs text-[var(--amber)]">
                  Eingaben unvollständig oder ungültig – Anzeige zeigt den letzten gültigen
                  Stand.
                </p>
              ) : null}
              <ChartLegend
                items={chart.legend}
              />
              <LineChart
                series={chart.series}
                xDomain={chart.xDomain}
                xTicks={chart.xTicks}
                xTooltipLabel={chart.tooltipTitle}
                markers={chart.markers}
                height={280}
                ariaLabel={chart.ariaLabel}
                tooltipExtra={(_values, x) =>
                  x === undefined ? null : chart.tooltipExtra(x)
                }
              />
              <ChartDataTable
                summary="Werte als Tabelle"
                columns={chart.tableColumns}
                rows={chart.tableRows}
              />
              <div
                className={cn(
                  "grid gap-3",
                  kpis.length > 3 ? "sm:grid-cols-2" : "sm:grid-cols-3",
                )}
              >
                {kpis.map((kpi) => (
                  <div
                    key={kpi.key}
                    className="rounded-lg border border-dashed border-[var(--border-sub)] px-3 py-2"
                  >
                    <p className="text-xs text-[var(--text-secondary)]">{kpi.label}</p>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        KPI_TONE_CLASS[kpi.tone],
                      )}
                    >
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <p>{describeKpiBasis(shown.result)}</p>
                <p className="font-medium text-[var(--text-primary)]">
                  {describeBreakEven(shown.result)}
                </p>
                <p className="tabular-nums">{describeInitialCashflow(shown.result)}</p>
                <p className="tabular-nums">{describeFinancing(shown.result)}</p>
              </div>
              <ExplanationDetails shown={shown} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                {evaluation.status === "empty" ? (
                  <>
                    <p>
                      Kaufpreis, Wohnfläche und Kaltmiete pro qm eingeben – dann erscheint
                      der Vergleich.
                    </p>
                    {origin === "kaufrechner" ? (
                      <p className="mt-2 text-xs">
                        Aus dem Kaufrechner übernommen: Kaufpreis, Nebenkosten,
                        Eigenkapital, Zins, Tilgung und WEG-Kosten. Wohnfläche und
                        Kaltmiete pro qm bitte ergänzen.
                      </p>
                    ) : null}
                    <ul className="mt-2 text-xs">
                      {evaluation.missing.map((key) => (
                        <li key={key}>{MISSING_LABELS[key]}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>{errors[FORM_ERROR_KEY] ?? "Bitte Eingaben prüfen."}</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {KPI_PLACEHOLDERS.map((kpi) => (
                  <div
                    key={kpi.key}
                    className="rounded-lg border border-dashed border-[var(--border-sub)] px-3 py-2"
                  >
                    <p className="text-xs text-[var(--text-secondary)]">{kpi.label}</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--text-secondary)]">
                      –
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
          <p className="font-medium text-[var(--text-primary)]">
            Modelliert, vereinfachte Steuerlogik, keine Steuerberatung.
          </p>
          <p>Vorabpauschale und Bundesland-Besonderheiten werden nicht abgebildet.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {onCopyLink ? <CopyLinkControl onCopyLink={onCopyLink} /> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: "resetAll" })}
          >
            Alles zurücksetzen
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DialogProps extends WorkbenchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PropertyVsEtfDialog({
  open,
  onOpenChange,
  state,
  dispatch,
  origin,
  onCopyLink,
}: DialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Immobilie vs. ETF"
      description="Inserat-Schnellcheck – reine Simulation, nichts wird gespeichert."
      className="max-w-6xl"
    >
      <PropertyVsEtfWorkbench
        state={state}
        dispatch={dispatch}
        origin={origin}
        onCopyLink={onCopyLink}
      />
    </Dialog>
  );
}
