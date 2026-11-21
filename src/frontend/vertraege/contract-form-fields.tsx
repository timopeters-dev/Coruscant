"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { ContractCategory, ContractStatus, RepaymentType } from "@/domain/contracts/contract";
import {
  remainingSpecialRepaymentCents, resolveRateCorridor,
} from "@/domain/contracts/loan-allowances";
import {
  repaymentBpsFromRate, type OptionRight, type RateChangeScope, type SpecialRepaymentBasis,
} from "@/domain/contracts/loan-options";
import { formatBpsDE, formatEuroDE } from "@/domain/core/money";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";
import { DatePicker } from "@/frontend/ui/date-picker";
import { Field, TextField } from "@/frontend/ui/field";
import { SegmentedControl } from "@/frontend/ui/segmented";
import { Select } from "@/frontend/ui/select";
import {
  hasPopulatedLoanOptions,
  previewLoanContract,
  type ContractFieldErrors,
  type ContractFormValues,
} from "./contract-form";

export {
  applyPrefillToContractFormValues,
  createInitialContractFormValues,
  mapApiFieldErrorsToContractErrors,
  validateAndBuildContractPayload,
  type ContractFieldErrors,
  type ContractFormValues,
} from "./contract-form";

const OPTION_RIGHTS: { value: OptionRight; label: string }[] = [
  { value: "unknown", label: "Unbekannt" },
  { value: "none", label: "Nicht möglich" },
  { value: "allowed", label: "Möglich" },
];

const LOAN_OPTION_ERROR_FIELDS: (keyof ContractFieldErrors)[] = [
  "originalPrincipalEuro",
  "specialRepaymentMaxYearlyEuro",
  "specialRepaymentPercent",
  "specialRepaymentUsedEuro",
  "rateChangeTotalCount",
  "rateChangeUsedCount",
  "rateChangeMinRepaymentPercent",
  "rateChangeMaxRepaymentPercent",
  "rateChangeMinMonthlyEuro",
  "rateChangeMaxMonthlyEuro",
  "rateChangeCorridor",
  "loanOptionsNote",
];

const PANEL = "space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4";
const SUBSECTION = "space-y-3 border-t border-[var(--border)] pt-4";
const STRONG_HINT = "tabular-nums text-xs font-medium text-[var(--text-primary)]";

export function ContractPrefillReviewNotice({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3.5 py-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--amber)]" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-[var(--text-primary)]">
            Folgende Kernfelder wurden nicht eindeutig erkannt oder per Fallback gesetzt – bitte manuell prüfen:
          </p>
          <p className="text-[var(--text-secondary)]">{hints.join(" · ")}</p>
        </div>
      </div>
    </div>
  );
}

/** Live-Hinweise zu Sondertilgung und Ratenkorridor aus dem aktuellen Formular. */
function useLoanHints(values: ContractFormValues) {
  return React.useMemo(() => {
    try {
      return computeLoanHints(values);
    } catch {
      return { special: null, corridor: null };
    }
  }, [values]);
}

function computeLoanHints(values: ContractFormValues): { special: string | null; corridor: string | null } {
  const contract = previewLoanContract(values);
    const asOf = `${values.specialRepaymentUsedYear}-01-01`;
    let special: string | null = null;
    let corridor: string | null = null;
    if (!contract) return { special, corridor };

    if (values.specialRepaymentRight === "allowed") {
      const allowance = remainingSpecialRepaymentCents(contract, asOf, contract.currentBalanceCents);
      if (allowance.flags.missingOriginalPrincipal) special = "Höhe unbekannt – Ursprungsbetrag fehlt.";
      else if (allowance.capCents === null) special = "Höhe nicht hinterlegt – Simulation ohne Jahresdeckel.";
      else {
        const cap = formatEuroDE(allowance.capCents);
        const remaining = allowance.remainingCents !== null ? formatEuroDE(allowance.remainingCents) : cap;
        special = `Entspricht ${cap}/Jahr, frei ${remaining} (${values.specialRepaymentUsedYear}).`;
      }
    }

    if (values.repaymentType !== "lump_sum" && values.rateChangeRight === "allowed") {
      const range = resolveRateCorridor(contract, asOf);
      if (!range.flags.corridorEmpty && range.minMonthlyCents !== null && range.maxMonthlyCents !== null) {
        const current = repaymentBpsFromRate(contract, contract.monthlyRateCents);
        corridor = [
          `Rate ${formatEuroDE(range.minMonthlyCents)}–${formatEuroDE(range.maxMonthlyCents)}/Monat`,
          current !== null ? `aktuell ≈ ${formatBpsDE(current.bps)} Tilgung` : null,
          range.flags.corridorAssumed ? "angenommener Korridor 1–10 %" : null,
          range.flags.approximatedBase ? "Näherung über Restschuld" : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }
  return { special, corridor };
}

interface ContractFormFieldsProps {
  values: ContractFormValues;
  onChange: (next: ContractFormValues) => void;
  errors: ContractFieldErrors;
  properties: PropertyRow[];
  disabled?: boolean;
  idPrefix?: string;
  hasPrefilledLoanOptions?: boolean;
}

export function ContractFormFields({
  values,
  onChange,
  errors,
  properties,
  disabled = false,
  idPrefix = "contract",
  hasPrefilledLoanOptions = false,
}: ContractFormFieldsProps) {
  const [optionsOpen, setOptionsOpen] = React.useState(() => hasPopulatedLoanOptions(values) || hasPrefilledLoanOptions);
  const hints = useLoanHints(values);
  const isLoan = values.category === "loan";
  const optionsExpanded = optionsOpen || LOAN_OPTION_ERROR_FIELDS.some((field) => errors[field]);

  const set = <K extends keyof ContractFormValues>(key: K, value: ContractFormValues[K]) => onChange({ ...values, [key]: value });

  /** Textfeld für einen Formularschlüssel; `id` wird aus dem Präfix gebildet. */
  const text = (
    key: keyof ContractFormValues & keyof ContractFieldErrors,
    idSuffix: string,
    label: React.ReactNode,
    options: { placeholder?: string; numeric?: "decimal" | "numeric"; hint?: React.ReactNode; className?: string } = {},
  ) => (
    <TextField
      id={`${idPrefix}-${idSuffix}`}
      label={label}
      value={String(values[key])}
      onValueChange={(next) => set(key, next as never)}
      error={errors[key]}
      disabled={disabled}
      {...options}
    />
  );

  const date = (key: "balanceAsOfDate" | "fixedInterestUntil" | "milestoneDate", idSuffix: string, label: string) => (
    <Field id={`${idPrefix}-${idSuffix}`} label={label} error={errors[key]}>
      <DatePicker
        id={`${idPrefix}-${idSuffix}`}
        value={values[key]}
        onChange={(next) => set(key, next)}
        hasError={Boolean(errors[key])}
        disabled={disabled}
      />
    </Field>
  );

  const select = <K extends keyof ContractFormValues>(
    key: K,
    idSuffix: string,
    label: string,
    options: [ContractFormValues[K] & string, string][],
    className?: string,
  ) => (
    <Field id={`${idPrefix}-${idSuffix}`} label={label} error={errors[key as keyof ContractFieldErrors]} className={className}>
      <Select
        id={`${idPrefix}-${idSuffix}`}
        value={String(values[key])}
        onChange={(e) => set(key, e.target.value as ContractFormValues[K])}
        hasError={Boolean(errors[key as keyof ContractFieldErrors])}
        disabled={disabled}
      >
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </Field>
  );

  const rightSwitch = (key: "specialRepaymentRight" | "rateChangeRight", label: string) => (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-[var(--text-primary)]">{label}</span>
      <SegmentedControl label={label} options={OPTION_RIGHTS} value={values[key]} onChange={(next) => set(key, next)} disabled={disabled} />
    </div>
  );

  return (
    <div className="@container space-y-5">
      <div className="grid gap-4 @md:grid-cols-2">
        {text("name", "name", "Vertragsname *", { placeholder: "z. B. Hauskredit Musterbank" })}
        {text("provider", "provider", "Anbieter / Gläubiger (optional)", { placeholder: "z. B. Musterbank AG" })}
      </div>

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
        {select("category", "category", "Kategorie", [
          ["loan" as ContractCategory, "Kredit / Darlehen"],
          ["savings_contract", "Bausparvertrag"],
        ])}
        {select("status", "status", "Status", [
          ["active" as ContractStatus, "Aktiv"],
          ["paused", "Pausiert"],
          ["closed", "Beendet"],
        ])}
        {select(
          "linkedPropertyId",
          "property",
          "Immobilie (optional)",
          [["", "Keine Verknüpfung"], ...properties.map((p): [string, string] => [p.id, p.name])],
          "@md:col-span-2",
        )}
      </div>

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
        {text("currentBalanceEuro", "balance", isLoan ? "Restschuld (€) *" : "Guthaben (€) *", {
          numeric: "decimal",
          placeholder: isLoan ? "z. B. 295000,00" : "z. B. -1200,00",
          hint: isLoan ? undefined : "Negativ möglich, wenn die Abschlussgebühr das Guthaben ins Minus gebracht hat.",
        })}
        {date("balanceAsOfDate", "date", "Geeicht per *")}
        {text("monthlyRateEuro", "rate", "Monatsrate (€)", { numeric: "decimal", placeholder: "z. B. 1400,00" })}
        {text("interestRatePercent", "interest", "Zinssatz (%)", { numeric: "decimal", placeholder: "z. B. 3,50" })}
      </div>

      {isLoan ? (
        <div className={PANEL}>
          <h3 className="section-label text-[var(--text-secondary)]">Kredit-Konditionen</h3>
          <div className="grid gap-4 @md:grid-cols-2">
            {select("repaymentType", "repayment-type", "Tilgungsart", [
              ["annuity" as RepaymentType, "Annuitätendarlehen"],
              ["installment", "Ratendarlehen"],
              ["lump_sum", "Endfällig (z. B. Verwandtendarlehen)"],
            ])}
            {date("fixedInterestUntil", "fixed-until", "Zinsbindung bis (optional)")}
          </div>
          {values.repaymentType === "lump_sum" ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Hinweis: Bei endfälligen Darlehen erfolgt keine automatische monatliche Tilgungsprojektion und kein Tilgungssatzwechsel.
            </p>
          ) : null}

          <div
            className={`rounded-xl border p-3.5 ${
              hasPrefilledLoanOptions ? "border-[var(--amber)]/50 bg-[var(--amber)]/5" : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <button
              type="button"
              onClick={() => setOptionsOpen((open) => !open)}
              aria-expanded={optionsExpanded}
              className="flex w-full items-center justify-between text-left section-label text-[var(--text-primary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
            >
              <span>Darlehensoptionen (Sondertilgung &amp; Tilgungswechsel)</span>
              <CollapseChevron open={optionsExpanded} className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>

            <Collapse open={optionsExpanded}>
              <div className="mt-4 space-y-5">
                {text("originalPrincipalEuro", "original-principal", "Ursprungsbetrag / Nennbetrag (€, optional)", {
                  numeric: "decimal",
                  placeholder: "z. B. 300000,00",
                  className: "@md:max-w-xs",
                })}

                <div className={SUBSECTION}>
                  {rightSwitch("specialRepaymentRight", "Sondertilgungsrecht")}
                  {values.specialRepaymentRight === "allowed" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 @lg:grid-cols-3">
                        {select("specialRepaymentBasis", "sr-basis", "Deckel-Basis", [
                          ["" as SpecialRepaymentBasis | "", "Höhe nicht hinterlegt"],
                          ["fixed_yearly", "€ pro Jahr"],
                          ["percent_original", "% vom Ursprungsbetrag"],
                          ["percent_balance", "% der Restschuld"],
                        ])}
                        {values.specialRepaymentBasis === "fixed_yearly"
                          ? text("specialRepaymentMaxYearlyEuro", "special-repayment", "Sondertilgung/Jahr (€)", {
                              numeric: "decimal",
                              placeholder: "z. B. 10000,00",
                            })
                          : null}
                        {values.specialRepaymentBasis.startsWith("percent_")
                          ? text("specialRepaymentPercent", "sr-percent", "Prozentsatz (%)", { numeric: "decimal", placeholder: "z. B. 5,00" })
                          : null}
                        {text("specialRepaymentUsedEuro", "sr-used", `Bereits genutzt in ${values.specialRepaymentUsedYear} (€)`, {
                          numeric: "decimal",
                          placeholder: "0,00",
                        })}
                      </div>
                      <div className="space-y-0.5 text-xs text-[var(--text-secondary)]">
                        {hints.special ? <p className={STRONG_HINT}>{hints.special}</p> : null}
                        <p>
                          Kontingent je Kalenderjahr gerechnet
                          {values.specialRepaymentBasis === "percent_balance" ? " (Restschuld zu Jahresbeginn)." : "."}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {values.repaymentType !== "lump_sum" ? (
                  <div className={SUBSECTION}>
                    {rightSwitch("rateChangeRight", "Tilgungssatzwechsel")}
                    {values.rateChangeRight === "allowed" ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 @lg:grid-cols-3">
                          {text("rateChangeTotalCount", "rc-count", "Erlaubte Wechsel (optional)", { numeric: "numeric", placeholder: "z. B. 2" })}
                          {select("rateChangeScope", "rc-scope", "Bezug", [
                            ["" as RateChangeScope | "", "Nicht festgelegt"],
                            ["term", "Gesamtlaufzeit"],
                            ["fixed_period", "je Zinsbindung"],
                            ["per_year", "pro Jahr"],
                          ])}
                          {text("rateChangeUsedCount", "rc-used", "Bereits genutzt", { numeric: "numeric", placeholder: "0" })}
                        </div>
                        <div className="grid gap-3 @md:grid-cols-2 @xl:grid-cols-4">
                          {text("rateChangeMinRepaymentPercent", "rc-min-bps", "Tilgung Min (%)", { numeric: "decimal", placeholder: "z. B. 1,00" })}
                          {text("rateChangeMaxRepaymentPercent", "rc-max-bps", "Tilgung Max (%)", { numeric: "decimal", placeholder: "z. B. 5,00" })}
                          {text("rateChangeMinMonthlyEuro", "rc-min-eur", "Rate Min (€)", { numeric: "decimal", placeholder: "optional" })}
                          {text("rateChangeMaxMonthlyEuro", "rc-max-eur", "Rate Max (€)", { numeric: "decimal", placeholder: "optional" })}
                        </div>
                        {errors.rateChangeCorridor ? (
                          <p className="text-xs font-medium text-[var(--rose)]">{errors.rateChangeCorridor}</p>
                        ) : null}
                        {hints.corridor ? <p className={STRONG_HINT}>{hints.corridor}</p> : null}
                        {values.rateChangeScope === "per_year" ? (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Bei jährlichem Bezug wird die Nutzung im laufenden Jahr nicht separat gezählt.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <Field
                  id={`${idPrefix}-loan-note`}
                  label="Vertragsnotiz (optional, max. 500 Zeichen)"
                  error={errors.loanOptionsNote}
                  hint="Bleibt lokal, nicht im anonymisierten Bericht."
                  className="border-t border-[var(--border)] pt-4"
                >
                  <textarea
                    id={`${idPrefix}-loan-note`}
                    rows={2}
                    maxLength={500}
                    value={values.loanOptionsNote}
                    onChange={(e) => set("loanOptionsNote", e.target.value)}
                    disabled={disabled}
                    placeholder="z. B. Sondertilgung nur zum 31.12., Wechsel 2× kostenlos"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
                  />
                </Field>
              </div>
            </Collapse>
          </div>
        </div>
      ) : (
        <div className={PANEL}>
          <h3 className="section-label text-[var(--text-secondary)]">Bauspar-Konditionen</h3>
          <div className="grid gap-4 @lg:grid-cols-3">
            {text("targetSumEuro", "target-sum", "Bausparsumme (€)", { numeric: "decimal", placeholder: "z. B. 50000,00" })}
            {text("allocationThresholdPercent", "allocation-threshold", "Zuteilungsschwelle (%)", { numeric: "numeric", placeholder: "z. B. 40" })}
            {text("futureLoanInterestRatePercent", "future-loan-rate", "Späterer Darlehenszins (%)", { numeric: "decimal", placeholder: "z. B. 2,50" })}
          </div>
        </div>
      )}

      <div className="grid gap-4 @md:grid-cols-2">
        {date("milestoneDate", "milestone-date", "Meilenstein-Datum (optional)")}
        {text("milestoneLabel", "milestone-label", "Meilenstein-Beschreibung (optional)", { placeholder: "z. B. Zuteilung oder Rückzahlung" })}
      </div>
    </div>
  );
}
