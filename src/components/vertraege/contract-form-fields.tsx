"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type { ContractPrefillResult } from "@/lib/domain/contract-prefill";
import type {
  ContractCategory,
  ContractStatus,
  RepaymentType,
} from "@/lib/domain/contracts";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/lib/domain/money";

export interface ContractFormValues {
  name: string;
  provider: string;
  category: ContractCategory;
  status: ContractStatus;
  linkedPropertyId: string;
  currentBalanceEuro: string;
  balanceAsOfDate: string;
  monthlyRateEuro: string;
  interestRatePercent: string;
  milestoneDate: string;
  milestoneLabel: string;
  repaymentType: RepaymentType;
  fixedInterestUntil: string;
  specialRepaymentMaxYearlyEuro: string;
  targetSumEuro: string;
  allocationThresholdPercent: string;
  futureLoanInterestRatePercent: string;
}

export interface ContractFieldErrors {
  name?: string;
  provider?: string;
  linkedPropertyId?: string;
  currentBalanceEuro?: string;
  balanceAsOfDate?: string;
  monthlyRateEuro?: string;
  interestRatePercent?: string;
  milestoneDate?: string;
  milestoneLabel?: string;
  fixedInterestUntil?: string;
  specialRepaymentMaxYearlyEuro?: string;
  targetSumEuro?: string;
  allocationThresholdPercent?: string;
  futureLoanInterestRatePercent?: string;
  general?: string;
}

export interface ContractPayload {
  name: string;
  provider: string | null;
  category: ContractCategory;
  status: ContractStatus;
  currentBalanceCents: number;
  balanceAsOfDate: string;
  monthlyRateCents: number;
  interestRateBps: number;
  linkedPropertyId: string | null;
  milestoneDate: string | null;
  milestoneLabel: string | null;
  repaymentType?: RepaymentType;
  fixedInterestUntil?: string | null;
  specialRepaymentMaxYearlyCents?: number | null;
  targetSumCents?: number | null;
  allocationThresholdPercent?: number | null;
  futureLoanInterestRateBps?: number | null;
}

export function createInitialContractFormValues(
  initialContract: FinancialContractRow | null | undefined,
  asOfDate: string,
): ContractFormValues {
  return {
    name: initialContract?.name ?? "",
    provider: initialContract?.provider ?? "",
    category: initialContract?.category ?? "loan",
    status: initialContract?.status ?? "active",
    linkedPropertyId: initialContract?.linkedPropertyId ?? "",
    currentBalanceEuro: initialContract
      ? centsToEuroInputString(initialContract.currentBalanceCents)
      : "",
    balanceAsOfDate: initialContract?.balanceAsOfDate ?? asOfDate,
    monthlyRateEuro: initialContract
      ? centsToEuroInputString(initialContract.monthlyRateCents)
      : "0,00",
    interestRatePercent: initialContract
      ? bpsToPercentInputString(initialContract.interestRateBps)
      : "0,00",
    milestoneDate: initialContract?.milestoneDate ?? "",
    milestoneLabel: initialContract?.milestoneLabel ?? "",
    repaymentType: initialContract?.repaymentType ?? "annuity",
    fixedInterestUntil: initialContract?.fixedInterestUntil ?? "",
    specialRepaymentMaxYearlyEuro:
      initialContract?.specialRepaymentMaxYearlyCents != null
        ? centsToEuroInputString(initialContract.specialRepaymentMaxYearlyCents)
        : "",
    targetSumEuro:
      initialContract?.targetSumCents != null
        ? centsToEuroInputString(initialContract.targetSumCents)
        : "",
    allocationThresholdPercent:
      initialContract?.allocationThresholdPercent != null
        ? String(initialContract.allocationThresholdPercent)
        : "",
    futureLoanInterestRatePercent:
      initialContract?.futureLoanInterestRateBps != null
        ? bpsToPercentInputString(initialContract.futureLoanInterestRateBps)
        : "",
  };
}

export function applyPrefillToContractFormValues(
  currentValues: ContractFormValues,
  prefill: ContractPrefillResult,
): ContractFormValues {
  const { values } = prefill;
  return {
    ...currentValues,
    name: values.name ?? "",
    provider: values.provider ?? "",
    category: values.category,
    currentBalanceEuro:
      values.currentBalanceCents != null
        ? centsToEuroInputString(values.currentBalanceCents)
        : "",
    balanceAsOfDate: values.balanceAsOfDate,
    monthlyRateEuro:
      values.monthlyRateCents != null
        ? centsToEuroInputString(values.monthlyRateCents)
        : "",
    interestRatePercent:
      values.interestRateBps != null
        ? bpsToPercentInputString(values.interestRateBps)
        : "",
    repaymentType: values.repaymentType,
    fixedInterestUntil: values.fixedInterestUntil ?? "",
    specialRepaymentMaxYearlyEuro:
      values.specialRepaymentMaxYearlyCents != null
        ? centsToEuroInputString(values.specialRepaymentMaxYearlyCents)
        : "",
    targetSumEuro:
      values.targetSumCents != null
        ? centsToEuroInputString(values.targetSumCents)
        : "",
    allocationThresholdPercent:
      values.allocationThresholdPercent != null
        ? String(values.allocationThresholdPercent)
        : "",
    futureLoanInterestRatePercent:
      values.futureLoanInterestRateBps != null
        ? bpsToPercentInputString(values.futureLoanInterestRateBps)
        : "",
    milestoneDate: values.milestoneDate ?? "",
    milestoneLabel: values.milestoneLabel ?? "",
  };
}

export function validateAndBuildContractPayload(
  values: ContractFormValues,
):
  | { ok: true; payload: ContractPayload }
  | { ok: false; errors: ContractFieldErrors } {
  const nextErrors: ContractFieldErrors = {};

  const trimmedName = values.name.trim();
  if (!trimmedName) {
    nextErrors.name = "Bitte einen Vertragsnamen eingeben.";
  }

  const currentBalanceCents = parseEuroInputToCents(values.currentBalanceEuro);
  if (currentBalanceCents === null || currentBalanceCents < 0) {
    nextErrors.currentBalanceEuro =
      "Bitte einen gültigen Stand >= 0,00 € eingeben.";
  }

  if (!values.balanceAsOfDate.trim()) {
    nextErrors.balanceAsOfDate = "Bitte das Stichtagsdatum angeben.";
  }

  const monthlyRateCents = parseEuroInputToCents(values.monthlyRateEuro);
  if (monthlyRateCents === null || monthlyRateCents < 0) {
    nextErrors.monthlyRateEuro =
      "Bitte eine gültige Monatsrate >= 0,00 € eingeben.";
  }

  const interestRateBps = parsePercentInputToBps(values.interestRatePercent);
  if (interestRateBps === null || interestRateBps > 100_000) {
    nextErrors.interestRatePercent =
      "Bitte einen gültigen Zinssatz in % angeben (z. B. 3,50).";
  }

  let specialRepaymentMaxYearlyCents: number | null = null;
  let targetSumCents: number | null = null;
  let parsedThreshold: number | null = null;
  let futureLoanInterestRateBps: number | null = null;

  if (values.category === "loan") {
    if (values.specialRepaymentMaxYearlyEuro.trim().length > 0) {
      const parsed = parseEuroInputToCents(
        values.specialRepaymentMaxYearlyEuro,
      );
      if (parsed === null || parsed < 0) {
        nextErrors.specialRepaymentMaxYearlyEuro =
          "Bitte einen gültigen Betrag >= 0,00 € eingeben.";
      } else {
        specialRepaymentMaxYearlyCents = parsed;
      }
    }
  } else {
    if (values.targetSumEuro.trim().length > 0) {
      const parsed = parseEuroInputToCents(values.targetSumEuro);
      if (parsed === null || parsed < 0) {
        nextErrors.targetSumEuro =
          "Bitte eine gültige Bausparsumme >= 0,00 € eingeben.";
      } else {
        targetSumCents = parsed;
      }
    }

    if (values.allocationThresholdPercent.trim().length > 0) {
      const raw = Number(values.allocationThresholdPercent.trim());
      if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
        nextErrors.allocationThresholdPercent =
          "Bitte eine ganze Zahl zwischen 0 und 100 eingeben.";
      } else {
        parsedThreshold = raw;
      }
    }

    if (values.futureLoanInterestRatePercent.trim().length > 0) {
      const parsed = parsePercentInputToBps(
        values.futureLoanInterestRatePercent,
      );
      if (parsed === null || parsed > 100_000) {
        nextErrors.futureLoanInterestRatePercent =
          "Bitte einen gültigen Zinssatz in % eingeben.";
      } else {
        futureLoanInterestRateBps = parsed;
      }
    }
  }

  if (
    Object.keys(nextErrors).length > 0 ||
    currentBalanceCents === null ||
    monthlyRateCents === null ||
    interestRateBps === null
  ) {
    return { ok: false, errors: nextErrors };
  }

  const base = {
    name: trimmedName,
    provider: values.provider.trim() || null,
    category: values.category,
    status: values.status,
    currentBalanceCents,
    balanceAsOfDate: values.balanceAsOfDate.trim(),
    monthlyRateCents,
    interestRateBps,
    linkedPropertyId: values.linkedPropertyId || null,
    milestoneDate: values.milestoneDate.trim() || null,
    milestoneLabel: values.milestoneLabel.trim() || null,
  };

  if (values.category === "loan") {
    return {
      ok: true,
      payload: {
        ...base,
        repaymentType: values.repaymentType,
        fixedInterestUntil: values.fixedInterestUntil.trim() || null,
        specialRepaymentMaxYearlyCents,
      },
    };
  }

  return {
    ok: true,
    payload: {
      ...base,
      targetSumCents,
      allocationThresholdPercent: parsedThreshold,
      futureLoanInterestRateBps,
    },
  };
}

export function mapApiFieldErrorsToContractErrors(
  error?: string,
  fieldErrors?: Record<string, string>,
): ContractFieldErrors {
  return {
    name: fieldErrors?.name ?? fieldErrors?.["contract.name"],
    provider: fieldErrors?.provider ?? fieldErrors?.["contract.provider"],
    linkedPropertyId:
      fieldErrors?.linkedPropertyId ??
      fieldErrors?.["contract.linkedPropertyId"],
    currentBalanceEuro:
      fieldErrors?.currentBalanceCents ??
      fieldErrors?.["contract.currentBalanceCents"],
    balanceAsOfDate:
      fieldErrors?.balanceAsOfDate ??
      fieldErrors?.["contract.balanceAsOfDate"],
    monthlyRateEuro:
      fieldErrors?.monthlyRateCents ??
      fieldErrors?.["contract.monthlyRateCents"],
    interestRatePercent:
      fieldErrors?.interestRateBps ??
      fieldErrors?.["contract.interestRateBps"],
    milestoneDate:
      fieldErrors?.milestoneDate ?? fieldErrors?.["contract.milestoneDate"],
    milestoneLabel:
      fieldErrors?.milestoneLabel ?? fieldErrors?.["contract.milestoneLabel"],
    fixedInterestUntil:
      fieldErrors?.fixedInterestUntil ??
      fieldErrors?.["contract.fixedInterestUntil"],
    specialRepaymentMaxYearlyEuro:
      fieldErrors?.specialRepaymentMaxYearlyCents ??
      fieldErrors?.["contract.specialRepaymentMaxYearlyCents"],
    targetSumEuro:
      fieldErrors?.targetSumCents ?? fieldErrors?.["contract.targetSumCents"],
    allocationThresholdPercent:
      fieldErrors?.allocationThresholdPercent ??
      fieldErrors?.["contract.allocationThresholdPercent"],
    futureLoanInterestRatePercent:
      fieldErrors?.futureLoanInterestRateBps ??
      fieldErrors?.["contract.futureLoanInterestRateBps"],
    general: error ?? "Speichern fehlgeschlagen.",
  };
}

export function ContractPrefillReviewNotice({ hints }: { hints: string[] }) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3.5 py-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--amber)]"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-medium text-[var(--text-primary)]">
            Folgende Kernfelder wurden nicht eindeutig erkannt oder per Fallback
            gesetzt – bitte manuell prüfen:
          </p>
          <p className="text-[var(--text-secondary)]">{hints.join(" · ")}</p>
        </div>
      </div>
    </div>
  );
}

interface ContractFormFieldsProps {
  values: ContractFormValues;
  onChange: (next: ContractFormValues) => void;
  errors: ContractFieldErrors;
  properties: PropertyRow[];
  disabled?: boolean;
  idPrefix?: string;
}

export function ContractFormFields({
  values,
  onChange,
  errors,
  properties,
  disabled = false,
  idPrefix = "contract",
}: ContractFormFieldsProps) {
  function updateField<K extends keyof ContractFormValues>(
    key: K,
    value: ContractFormValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Vertragsname *</Label>
          <Input
            id={`${idPrefix}-name`}
            value={values.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="z. B. Hauskredit Musterbank"
            hasError={Boolean(errors.name)}
            disabled={disabled}
          />
          {errors.name ? (
            <p className="text-xs text-[var(--rose)]">{errors.name}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-provider`}>
            Anbieter / Gläubiger (optional)
          </Label>
          <Input
            id={`${idPrefix}-provider`}
            value={values.provider}
            onChange={(e) => updateField("provider", e.target.value)}
            placeholder="z. B. Musterbank AG"
            hasError={Boolean(errors.provider)}
            disabled={disabled}
          />
          {errors.provider ? (
            <p className="text-xs text-[var(--rose)]">{errors.provider}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-category`}>Kategorie</Label>
          <Select
            id={`${idPrefix}-category`}
            value={values.category}
            onChange={(e) =>
              updateField("category", e.target.value as ContractCategory)
            }
            disabled={disabled}
          >
            <option value="loan">Kredit / Darlehen</option>
            <option value="savings_contract">Bausparvertrag</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-status`}>Status</Label>
          <Select
            id={`${idPrefix}-status`}
            value={values.status}
            onChange={(e) =>
              updateField("status", e.target.value as ContractStatus)
            }
            disabled={disabled}
          >
            <option value="active">Aktiv</option>
            <option value="paused">Pausiert</option>
            <option value="closed">Beendet</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-property`}>Immobilie (optional)</Label>
          <Select
            id={`${idPrefix}-property`}
            value={values.linkedPropertyId}
            onChange={(e) => updateField("linkedPropertyId", e.target.value)}
            hasError={Boolean(errors.linkedPropertyId)}
            disabled={disabled}
          >
            <option value="">Keine Verknüpfung</option>
            {properties.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.name}
              </option>
            ))}
          </Select>
          {errors.linkedPropertyId ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.linkedPropertyId}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-balance`}>
            {values.category === "loan" ? "Restschuld (€) *" : "Guthaben (€) *"}
          </Label>
          <Input
            id={`${idPrefix}-balance`}
            inputMode="decimal"
            value={values.currentBalanceEuro}
            onChange={(e) => updateField("currentBalanceEuro", e.target.value)}
            placeholder="z. B. 295000,00"
            hasError={Boolean(errors.currentBalanceEuro)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.currentBalanceEuro ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.currentBalanceEuro}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-date`}>Geeicht per *</Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={values.balanceAsOfDate}
            onChange={(e) => updateField("balanceAsOfDate", e.target.value)}
            hasError={Boolean(errors.balanceAsOfDate)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.balanceAsOfDate ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.balanceAsOfDate}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-rate`}>Monatsrate (€)</Label>
          <Input
            id={`${idPrefix}-rate`}
            inputMode="decimal"
            value={values.monthlyRateEuro}
            onChange={(e) => updateField("monthlyRateEuro", e.target.value)}
            placeholder="z. B. 1400,00"
            hasError={Boolean(errors.monthlyRateEuro)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.monthlyRateEuro ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.monthlyRateEuro}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-interest`}>Zinssatz (%)</Label>
          <Input
            id={`${idPrefix}-interest`}
            inputMode="decimal"
            value={values.interestRatePercent}
            onChange={(e) =>
              updateField("interestRatePercent", e.target.value)
            }
            placeholder="z. B. 3,50"
            hasError={Boolean(errors.interestRatePercent)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.interestRatePercent ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.interestRatePercent}
            </p>
          ) : null}
        </div>
      </div>

      {values.category === "loan" ? (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Kredit-Konditionen
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-repayment-type`}>Tilgungsart</Label>
              <Select
                id={`${idPrefix}-repayment-type`}
                value={values.repaymentType}
                onChange={(e) =>
                  updateField("repaymentType", e.target.value as RepaymentType)
                }
                disabled={disabled}
              >
                <option value="annuity">Annuitätendarlehen</option>
                <option value="installment">Ratendarlehen</option>
                <option value="lump_sum">Endfällig (z. B. Verwandtendarlehen)</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-fixed-until`}>
                Zinsbindung bis (optional)
              </Label>
              <Input
                id={`${idPrefix}-fixed-until`}
                type="date"
                value={values.fixedInterestUntil}
                onChange={(e) =>
                  updateField("fixedInterestUntil", e.target.value)
                }
                hasError={Boolean(errors.fixedInterestUntil)}
                disabled={disabled}
                className="tabular-nums"
              />
              {errors.fixedInterestUntil ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.fixedInterestUntil}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-special-repayment`}>
                Sondertilgung/Jahr (€)
              </Label>
              <Input
                id={`${idPrefix}-special-repayment`}
                inputMode="decimal"
                value={values.specialRepaymentMaxYearlyEuro}
                onChange={(e) =>
                  updateField("specialRepaymentMaxYearlyEuro", e.target.value)
                }
                placeholder="z. B. 10000,00"
                hasError={Boolean(errors.specialRepaymentMaxYearlyEuro)}
                disabled={disabled}
                className="tabular-nums"
              />
              {errors.specialRepaymentMaxYearlyEuro ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.specialRepaymentMaxYearlyEuro}
                </p>
              ) : null}
            </div>
          </div>

          {values.repaymentType === "lump_sum" ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Hinweis: Bei endfälligen Darlehen erfolgt keine
              automatische monatliche Tilgungsprojektion.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Bauspar-Konditionen
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-target-sum`}>Bausparsumme (€)</Label>
              <Input
                id={`${idPrefix}-target-sum`}
                inputMode="decimal"
                value={values.targetSumEuro}
                onChange={(e) => updateField("targetSumEuro", e.target.value)}
                placeholder="z. B. 50000,00"
                hasError={Boolean(errors.targetSumEuro)}
                disabled={disabled}
                className="tabular-nums"
              />
              {errors.targetSumEuro ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.targetSumEuro}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-allocation-threshold`}>
                Zuteilungsschwelle (%)
              </Label>
              <Input
                id={`${idPrefix}-allocation-threshold`}
                inputMode="numeric"
                value={values.allocationThresholdPercent}
                onChange={(e) =>
                  updateField("allocationThresholdPercent", e.target.value)
                }
                placeholder="z. B. 40"
                hasError={Boolean(errors.allocationThresholdPercent)}
                disabled={disabled}
                className="tabular-nums"
              />
              {errors.allocationThresholdPercent ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.allocationThresholdPercent}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-future-loan-rate`}>
                Späterer Darlehenszins (%)
              </Label>
              <Input
                id={`${idPrefix}-future-loan-rate`}
                inputMode="decimal"
                value={values.futureLoanInterestRatePercent}
                onChange={(e) =>
                  updateField("futureLoanInterestRatePercent", e.target.value)
                }
                placeholder="z. B. 2,50"
                hasError={Boolean(errors.futureLoanInterestRatePercent)}
                disabled={disabled}
                className="tabular-nums"
              />
              {errors.futureLoanInterestRatePercent ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.futureLoanInterestRatePercent}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-milestone-date`}>
            Meilenstein-Datum (optional)
          </Label>
          <Input
            id={`${idPrefix}-milestone-date`}
            type="date"
            value={values.milestoneDate}
            onChange={(e) => updateField("milestoneDate", e.target.value)}
            hasError={Boolean(errors.milestoneDate)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.milestoneDate ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.milestoneDate}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-milestone-label`}>
            Meilenstein-Beschreibung (optional)
          </Label>
          <Input
            id={`${idPrefix}-milestone-label`}
            value={values.milestoneLabel}
            onChange={(e) => updateField("milestoneLabel", e.target.value)}
            placeholder="z. B. Zuteilung oder Rückzahlung"
            hasError={Boolean(errors.milestoneLabel)}
            disabled={disabled}
          />
          {errors.milestoneLabel ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.milestoneLabel}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
