"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/frontend/ui/input";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import type { FinancialContractRow, PropertyRow } from "@/backend/db/queries/contracts";
import type { ContractPrefillResult } from "@/domain/contracts/prefill";
import type {
  ContractCategory,
  ContractStatus,
  DomainContract,
  RepaymentType,
} from "@/domain/contracts/contract";
import {
  MAX_RATE_CHANGE_COUNT,
  type OptionRight,
  type RateChangeScope,
  remainingSpecialRepaymentCents,
  repaymentBpsFromRate,
  resolveRateCorridor,
  type SpecialRepaymentBasis,
} from "@/domain/contracts/loan-options";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  formatBpsDE,
  formatEuroDE,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/domain/core/money";
import { DatePicker } from "@/frontend/ui/date-picker";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/frontend/ui/segmented";

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
  originalPrincipalEuro: string;
  specialRepaymentRight: OptionRight;
  specialRepaymentBasis: SpecialRepaymentBasis | "";
  specialRepaymentMaxYearlyEuro: string;
  specialRepaymentPercent: string;
  specialRepaymentUsedEuro: string;
  specialRepaymentUsedYear: number;
  rateChangeRight: OptionRight;
  rateChangeTotalCount: string;
  rateChangeScope: RateChangeScope | "";
  rateChangeUsedCount: string;
  rateChangeMinRepaymentPercent: string;
  rateChangeMaxRepaymentPercent: string;
  rateChangeMinMonthlyEuro: string;
  rateChangeMaxMonthlyEuro: string;
  loanOptionsNote: string;
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
  originalPrincipalEuro?: string;
  specialRepaymentMaxYearlyEuro?: string;
  specialRepaymentPercent?: string;
  specialRepaymentUsedEuro?: string;
  rateChangeTotalCount?: string;
  rateChangeUsedCount?: string;
  rateChangeMinRepaymentPercent?: string;
  rateChangeMaxRepaymentPercent?: string;
  rateChangeMinMonthlyEuro?: string;
  rateChangeMaxMonthlyEuro?: string;
  rateChangeCorridor?: string;
  loanOptionsNote?: string;
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
  originalPrincipalCents?: number | null;
  specialRepaymentRight?: OptionRight;
  specialRepaymentBasis?: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents?: number | null;
  specialRepaymentPercentBps?: number | null;
  specialRepaymentUsedCents?: number | null;
  specialRepaymentUsedYear?: number | null;
  rateChangeRight?: OptionRight;
  rateChangeTotalCount?: number | null;
  rateChangeScope?: RateChangeScope | null;
  rateChangeUsedCount?: number;
  rateChangeMinRepaymentBps?: number | null;
  rateChangeMaxRepaymentBps?: number | null;
  rateChangeMinMonthlyCents?: number | null;
  rateChangeMaxMonthlyCents?: number | null;
  loanOptionsNote?: string | null;
  targetSumCents?: number | null;
  allocationThresholdPercent?: number | null;
  futureLoanInterestRateBps?: number | null;
}

function yearFromIsoDate(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : 2026;
}

export function hasPopulatedLoanOptions(values: ContractFormValues): boolean {
  return (
    values.originalPrincipalEuro.trim().length > 0 ||
    values.specialRepaymentRight !== "unknown" ||
    values.specialRepaymentUsedEuro.trim().length > 0 ||
    values.rateChangeRight !== "unknown" ||
    values.loanOptionsNote.trim().length > 0
  );
}

export function createInitialContractFormValues(
  initialContract: FinancialContractRow | null | undefined,
  asOfDate: string,
): ContractFormValues {
  const currentYear = yearFromIsoDate(asOfDate);
  const usedInCurrentYear =
    initialContract?.specialRepaymentUsedYear === currentYear &&
    initialContract.specialRepaymentUsedCents != null
      ? centsToEuroInputString(initialContract.specialRepaymentUsedCents)
      : "";

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
    originalPrincipalEuro:
      initialContract?.originalPrincipalCents != null
        ? centsToEuroInputString(initialContract.originalPrincipalCents)
        : "",
    specialRepaymentRight: initialContract?.specialRepaymentRight ?? "unknown",
    specialRepaymentBasis: initialContract?.specialRepaymentBasis ?? "",
    specialRepaymentMaxYearlyEuro:
      initialContract?.specialRepaymentMaxYearlyCents != null
        ? centsToEuroInputString(initialContract.specialRepaymentMaxYearlyCents)
        : "",
    specialRepaymentPercent:
      initialContract?.specialRepaymentPercentBps != null
        ? bpsToPercentInputString(initialContract.specialRepaymentPercentBps)
        : "",
    specialRepaymentUsedEuro: usedInCurrentYear,
    specialRepaymentUsedYear: currentYear,
    rateChangeRight: initialContract?.rateChangeRight ?? "unknown",
    rateChangeTotalCount:
      initialContract?.rateChangeTotalCount != null
        ? String(initialContract.rateChangeTotalCount)
        : "",
    rateChangeScope: initialContract?.rateChangeScope ?? "",
    rateChangeUsedCount:
      initialContract?.rateChangeUsedCount != null
        ? String(initialContract.rateChangeUsedCount)
        : "0",
    rateChangeMinRepaymentPercent:
      initialContract?.rateChangeMinRepaymentBps != null
        ? bpsToPercentInputString(initialContract.rateChangeMinRepaymentBps)
        : "",
    rateChangeMaxRepaymentPercent:
      initialContract?.rateChangeMaxRepaymentBps != null
        ? bpsToPercentInputString(initialContract.rateChangeMaxRepaymentBps)
        : "",
    rateChangeMinMonthlyEuro:
      initialContract?.rateChangeMinMonthlyCents != null
        ? centsToEuroInputString(initialContract.rateChangeMinMonthlyCents)
        : "",
    rateChangeMaxMonthlyEuro:
      initialContract?.rateChangeMaxMonthlyCents != null
        ? centsToEuroInputString(initialContract.rateChangeMaxMonthlyCents)
        : "",
    loanOptionsNote: initialContract?.loanOptionsNote ?? "",
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
    originalPrincipalEuro:
      values.originalPrincipalCents != null
        ? centsToEuroInputString(values.originalPrincipalCents)
        : "",
    specialRepaymentRight: values.specialRepaymentRight,
    specialRepaymentBasis: values.specialRepaymentBasis ?? "",
    specialRepaymentMaxYearlyEuro:
      values.specialRepaymentMaxYearlyCents != null
        ? centsToEuroInputString(values.specialRepaymentMaxYearlyCents)
        : "",
    specialRepaymentPercent:
      values.specialRepaymentPercentBps != null
        ? bpsToPercentInputString(values.specialRepaymentPercentBps)
        : "",
    rateChangeRight: values.rateChangeRight,
    rateChangeTotalCount:
      values.rateChangeTotalCount != null
        ? String(values.rateChangeTotalCount)
        : "",
    rateChangeScope: values.rateChangeScope ?? "",
    rateChangeMinRepaymentPercent:
      values.rateChangeMinRepaymentBps != null
        ? bpsToPercentInputString(values.rateChangeMinRepaymentBps)
        : "",
    rateChangeMaxRepaymentPercent:
      values.rateChangeMaxRepaymentBps != null
        ? bpsToPercentInputString(values.rateChangeMaxRepaymentBps)
        : "",
    rateChangeMinMonthlyEuro:
      values.rateChangeMinMonthlyCents != null
        ? centsToEuroInputString(values.rateChangeMinMonthlyCents)
        : "",
    rateChangeMaxMonthlyEuro:
      values.rateChangeMaxMonthlyCents != null
        ? centsToEuroInputString(values.rateChangeMaxMonthlyCents)
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
  if (values.category === "savings_contract") {
    // Bausparverträge dürfen durch die Abschlussgebühr negativ starten.
    if (currentBalanceCents === null) {
      nextErrors.currentBalanceEuro =
        "Bitte ein gültiges Guthaben eingeben (negativ möglich, z. B. -1200,00).";
    }
  } else if (currentBalanceCents === null || currentBalanceCents < 0) {
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

  let originalPrincipalCents: number | null = null;
  let specialRepaymentBasis: SpecialRepaymentBasis | null = null;
  let specialRepaymentMaxYearlyCents: number | null = null;
  let specialRepaymentPercentBps: number | null = null;
  let specialRepaymentUsedCents: number | null = null;
  let specialRepaymentUsedYear: number | null = null;
  let rateChangeRight: OptionRight = values.rateChangeRight;
  let rateChangeTotalCount: number | null = null;
  let rateChangeScope: RateChangeScope | null = null;
  let rateChangeUsedCount = 0;
  let rateChangeMinRepaymentBps: number | null = null;
  let rateChangeMaxRepaymentBps: number | null = null;
  let rateChangeMinMonthlyCents: number | null = null;
  let rateChangeMaxMonthlyCents: number | null = null;
  let loanOptionsNote: string | null = null;

  let targetSumCents: number | null = null;
  let parsedThreshold: number | null = null;
  let futureLoanInterestRateBps: number | null = null;

  if (values.category === "loan") {
    if (values.originalPrincipalEuro.trim().length > 0) {
      const parsed = parseEuroInputToCents(values.originalPrincipalEuro);
      if (parsed === null || parsed <= 0) {
        nextErrors.originalPrincipalEuro =
          "Bitte einen Ursprungsbetrag größer als 0,00 € eingeben.";
      } else {
        originalPrincipalCents = parsed;
      }
    }

    if (values.specialRepaymentRight === "allowed") {
      specialRepaymentBasis =
        values.specialRepaymentBasis === ""
          ? null
          : values.specialRepaymentBasis;

      if (specialRepaymentBasis === "fixed_yearly") {
        const parsed = parseEuroInputToCents(
          values.specialRepaymentMaxYearlyEuro,
        );
        if (parsed === null || parsed <= 0) {
          nextErrors.specialRepaymentMaxYearlyEuro =
            "Bitte einen gültigen Betrag > 0,00 € eingeben.";
        } else {
          specialRepaymentMaxYearlyCents = parsed;
        }
      } else if (
        specialRepaymentBasis === "percent_original" ||
        specialRepaymentBasis === "percent_balance"
      ) {
        const parsed = parsePercentInputToBps(values.specialRepaymentPercent);
        if (parsed === null || parsed <= 0 || parsed > 10_000) {
          nextErrors.specialRepaymentPercent =
            "Bitte einen Prozentsatz zwischen 0,01 % und 100 % eingeben.";
        } else {
          specialRepaymentPercentBps = parsed;
        }
      }
    }

    if (values.specialRepaymentUsedEuro.trim().length > 0) {
      const parsed = parseEuroInputToCents(values.specialRepaymentUsedEuro);
      if (parsed === null || parsed < 0) {
        nextErrors.specialRepaymentUsedEuro =
          "Bitte einen gültigen Betrag >= 0,00 € eingeben.";
      } else {
        specialRepaymentUsedCents = parsed;
        specialRepaymentUsedYear = values.specialRepaymentUsedYear;
      }
    }

    if (values.repaymentType === "lump_sum") {
      rateChangeRight = "none";
    } else if (values.rateChangeRight === "allowed") {
      if (values.rateChangeTotalCount.trim().length > 0) {
        const raw = Number(values.rateChangeTotalCount.trim());
        if (!Number.isInteger(raw) || raw < 1 || raw > MAX_RATE_CHANGE_COUNT) {
          nextErrors.rateChangeTotalCount = `Bitte eine ganze Zahl zwischen 1 und ${MAX_RATE_CHANGE_COUNT} eingeben.`;
        } else {
          rateChangeTotalCount = raw;
        }
      }

      rateChangeScope =
        values.rateChangeScope === "" ? null : values.rateChangeScope;

      if (values.rateChangeUsedCount.trim().length > 0) {
        const raw = Number(values.rateChangeUsedCount.trim());
        if (!Number.isInteger(raw) || raw < 0) {
          nextErrors.rateChangeUsedCount =
            "Bitte eine ganze Zahl >= 0 eingeben.";
        } else {
          rateChangeUsedCount = raw;
        }
      }

      if (
        rateChangeTotalCount !== null &&
        rateChangeScope !== "per_year" &&
        rateChangeUsedCount > rateChangeTotalCount
      ) {
        nextErrors.rateChangeUsedCount = `Genutzte Wechsel (${rateChangeUsedCount}) dürfen die erlaubte Anzahl (${rateChangeTotalCount}) nicht überschreiten.`;
      }

      if (values.rateChangeMinRepaymentPercent.trim().length > 0) {
        const parsed = parsePercentInputToBps(
          values.rateChangeMinRepaymentPercent,
        );
        if (parsed === null || parsed < 0 || parsed > 10_000) {
          nextErrors.rateChangeMinRepaymentPercent =
            "Bitte einen Prozentsatz zwischen 0 % und 100 % eingeben.";
        } else {
          rateChangeMinRepaymentBps = parsed;
        }
      }

      if (values.rateChangeMaxRepaymentPercent.trim().length > 0) {
        const parsed = parsePercentInputToBps(
          values.rateChangeMaxRepaymentPercent,
        );
        if (parsed === null || parsed < 0 || parsed > 10_000) {
          nextErrors.rateChangeMaxRepaymentPercent =
            "Bitte einen Prozentsatz zwischen 0 % und 100 % eingeben.";
        } else {
          rateChangeMaxRepaymentBps = parsed;
        }
      }

      if (
        rateChangeMinRepaymentBps !== null &&
        rateChangeMaxRepaymentBps !== null &&
        rateChangeMinRepaymentBps > rateChangeMaxRepaymentBps
      ) {
        nextErrors.rateChangeMaxRepaymentPercent =
          "Max. Tilgungssatz darf nicht kleiner als Min. sein.";
      }

      if (values.rateChangeMinMonthlyEuro.trim().length > 0) {
        const parsed = parseEuroInputToCents(values.rateChangeMinMonthlyEuro);
        if (parsed === null || parsed < 0) {
          nextErrors.rateChangeMinMonthlyEuro =
            "Bitte eine gültige Rate >= 0,00 € eingeben.";
        } else {
          rateChangeMinMonthlyCents = parsed;
        }
      }

      if (values.rateChangeMaxMonthlyEuro.trim().length > 0) {
        const parsed = parseEuroInputToCents(values.rateChangeMaxMonthlyEuro);
        if (parsed === null || parsed < 0) {
          nextErrors.rateChangeMaxMonthlyEuro =
            "Bitte eine gültige Rate >= 0,00 € eingeben.";
        } else {
          rateChangeMaxMonthlyCents = parsed;
        }
      }

      if (
        rateChangeMinMonthlyCents !== null &&
        rateChangeMaxMonthlyCents !== null &&
        rateChangeMinMonthlyCents > rateChangeMaxMonthlyCents
      ) {
        nextErrors.rateChangeMaxMonthlyEuro =
          "Max. Monatsrate darf nicht kleiner als Min. sein.";
      }

      if (
        !nextErrors.rateChangeMaxRepaymentPercent &&
        !nextErrors.rateChangeMaxMonthlyEuro &&
        currentBalanceCents !== null &&
        monthlyRateCents !== null &&
        interestRateBps !== null &&
        values.balanceAsOfDate.trim().length > 0
      ) {
        const corridor = resolveRateCorridor(
          {
            id: "form-check",
            name: trimmedName || "Kredit",
            category: "loan",
            status: values.status,
            currentBalanceCents,
            balanceAsOfDate: values.balanceAsOfDate.trim(),
            monthlyRateCents,
            interestRateBps,
            repaymentType: values.repaymentType,
            originalPrincipalCents,
            rateChangeRight: "allowed",
            rateChangeTotalCount,
            rateChangeScope,
            rateChangeUsedCount,
            rateChangeMinRepaymentBps,
            rateChangeMaxRepaymentBps,
            rateChangeMinMonthlyCents,
            rateChangeMaxMonthlyCents,
            fixedInterestUntil: values.fixedInterestUntil.trim() || null,
          },
          values.balanceAsOfDate.trim(),
        );
        if (corridor.flags.corridorEmpty) {
          nextErrors.rateChangeCorridor =
            "Tilgungssatz- und Raten-Korridor haben keine gemeinsame Schnittmenge.";
        }
      }
    }

    const trimmedNote = values.loanOptionsNote.trim();
    if (trimmedNote.length > 500) {
      nextErrors.loanOptionsNote = "Notiz darf höchstens 500 Zeichen enthalten.";
    } else if (trimmedNote.length > 0) {
      loanOptionsNote = trimmedNote;
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
        originalPrincipalCents,
        specialRepaymentRight: values.specialRepaymentRight,
        specialRepaymentBasis,
        specialRepaymentMaxYearlyCents,
        specialRepaymentPercentBps,
        specialRepaymentUsedCents,
        specialRepaymentUsedYear,
        rateChangeRight,
        rateChangeTotalCount,
        rateChangeScope,
        rateChangeUsedCount,
        rateChangeMinRepaymentBps,
        rateChangeMaxRepaymentBps,
        rateChangeMinMonthlyCents,
        rateChangeMaxMonthlyCents,
        loanOptionsNote,
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
  const pick = (key: string) =>
    fieldErrors?.[key] ?? fieldErrors?.[`contract.${key}`];
  return {
    name: pick("name"),
    provider: pick("provider"),
    linkedPropertyId: pick("linkedPropertyId"),
    currentBalanceEuro: pick("currentBalanceCents"),
    balanceAsOfDate: pick("balanceAsOfDate"),
    monthlyRateEuro: pick("monthlyRateCents"),
    interestRatePercent: pick("interestRateBps"),
    milestoneDate: pick("milestoneDate"),
    milestoneLabel: pick("milestoneLabel"),
    fixedInterestUntil: pick("fixedInterestUntil"),
    originalPrincipalEuro: pick("originalPrincipalCents"),
    specialRepaymentMaxYearlyEuro: pick("specialRepaymentMaxYearlyCents"),
    specialRepaymentPercent: pick("specialRepaymentPercentBps"),
    specialRepaymentUsedEuro:
      pick("specialRepaymentUsedCents") ?? pick("specialRepaymentUsedYear"),
    rateChangeTotalCount: pick("rateChangeTotalCount"),
    rateChangeUsedCount: pick("rateChangeUsedCount"),
    rateChangeMinRepaymentPercent: pick("rateChangeMinRepaymentBps"),
    rateChangeMaxRepaymentPercent: pick("rateChangeMaxRepaymentBps"),
    rateChangeMinMonthlyEuro: pick("rateChangeMinMonthlyCents"),
    rateChangeMaxMonthlyEuro: pick("rateChangeMaxMonthlyCents"),
    rateChangeCorridor: pick("rateChangeCorridor"),
    loanOptionsNote: pick("loanOptionsNote"),
    targetSumEuro: pick("targetSumCents"),
    allocationThresholdPercent: pick("allocationThresholdPercent"),
    futureLoanInterestRatePercent: pick("futureLoanInterestRateBps"),
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

function buildPreviewDomainContract(
  values: ContractFormValues,
): DomainContract | null {
  if (values.category !== "loan") return null;
  const currentBalanceCents = parseEuroInputToCents(values.currentBalanceEuro);
  const monthlyRateCents = parseEuroInputToCents(values.monthlyRateEuro);
  const interestRateBps = parsePercentInputToBps(values.interestRatePercent);
  if (
    currentBalanceCents === null ||
    currentBalanceCents < 0 ||
    monthlyRateCents === null ||
    monthlyRateCents < 0 ||
    interestRateBps === null ||
    interestRateBps < 0
  ) {
    return null;
  }
  const orig = values.originalPrincipalEuro.trim()
    ? parseEuroInputToCents(values.originalPrincipalEuro)
    : null;
  const maxYearly = values.specialRepaymentMaxYearlyEuro.trim()
    ? parseEuroInputToCents(values.specialRepaymentMaxYearlyEuro)
    : null;
  const srPct = values.specialRepaymentPercent.trim()
    ? parsePercentInputToBps(values.specialRepaymentPercent)
    : null;
  const srUsed = values.specialRepaymentUsedEuro.trim()
    ? parseEuroInputToCents(values.specialRepaymentUsedEuro)
    : null;
  const rcCountRaw = values.rateChangeTotalCount.trim()
    ? Number(values.rateChangeTotalCount.trim())
    : null;
  const rcUsedRaw = values.rateChangeUsedCount.trim()
    ? Number(values.rateChangeUsedCount.trim())
    : 0;
  const minBps = values.rateChangeMinRepaymentPercent.trim()
    ? parsePercentInputToBps(values.rateChangeMinRepaymentPercent)
    : null;
  const maxBps = values.rateChangeMaxRepaymentPercent.trim()
    ? parsePercentInputToBps(values.rateChangeMaxRepaymentPercent)
    : null;
  const minMonthly = values.rateChangeMinMonthlyEuro.trim()
    ? parseEuroInputToCents(values.rateChangeMinMonthlyEuro)
    : null;
  const maxMonthly = values.rateChangeMaxMonthlyEuro.trim()
    ? parseEuroInputToCents(values.rateChangeMaxMonthlyEuro)
    : null;

  return {
    id: "preview",
    name: values.name.trim() || "Kredit",
    category: "loan",
    status: values.status,
    currentBalanceCents,
    balanceAsOfDate: values.balanceAsOfDate || `${values.specialRepaymentUsedYear}-01-01`,
    monthlyRateCents,
    interestRateBps,
    repaymentType: values.repaymentType,
    fixedInterestUntil: values.fixedInterestUntil.trim() || null,
    originalPrincipalCents: orig !== null && orig > 0 ? orig : null,
    specialRepaymentRight: values.specialRepaymentRight,
    specialRepaymentBasis:
      values.specialRepaymentRight === "allowed" &&
      values.specialRepaymentBasis !== ""
        ? values.specialRepaymentBasis
        : null,
    specialRepaymentMaxYearlyCents:
      values.specialRepaymentRight === "allowed" &&
      values.specialRepaymentBasis === "fixed_yearly" &&
      maxYearly !== null &&
      maxYearly > 0
        ? maxYearly
        : null,
    specialRepaymentPercentBps:
      values.specialRepaymentRight === "allowed" &&
      (values.specialRepaymentBasis === "percent_original" ||
        values.specialRepaymentBasis === "percent_balance") &&
      srPct !== null &&
      srPct > 0 &&
      srPct <= 10_000
        ? srPct
        : null,
    specialRepaymentUsedCents: srUsed !== null && srUsed >= 0 ? srUsed : null,
    specialRepaymentUsedYear:
      srUsed !== null && srUsed >= 0 ? values.specialRepaymentUsedYear : null,
    rateChangeRight:
      values.repaymentType === "lump_sum" ? "none" : values.rateChangeRight,
    rateChangeTotalCount:
      rcCountRaw !== null &&
      Number.isInteger(rcCountRaw) &&
      rcCountRaw >= 1 &&
      rcCountRaw <= MAX_RATE_CHANGE_COUNT
        ? rcCountRaw
        : null,
    rateChangeScope:
      values.rateChangeScope !== "" ? values.rateChangeScope : null,
    rateChangeUsedCount:
      Number.isInteger(rcUsedRaw) && rcUsedRaw >= 0 ? rcUsedRaw : 0,
    rateChangeMinRepaymentBps:
      minBps !== null && minBps >= 0 && minBps <= 10_000 ? minBps : null,
    rateChangeMaxRepaymentBps:
      maxBps !== null && maxBps >= 0 && maxBps <= 10_000 ? maxBps : null,
    rateChangeMinMonthlyCents:
      minMonthly !== null && minMonthly >= 0 ? minMonthly : null,
    rateChangeMaxMonthlyCents:
      maxMonthly !== null && maxMonthly >= 0 ? maxMonthly : null,
  };
}

const OPTION_RIGHT_SEGMENTS: { value: OptionRight; label: string }[] = [
  { value: "unknown", label: "Unbekannt" },
  { value: "none", label: "Nicht möglich" },
  { value: "allowed", label: "Möglich" },
];

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
  const [optionsOpen, setOptionsOpen] = React.useState<boolean>(
    () => hasPopulatedLoanOptions(values) || hasPrefilledLoanOptions,
  );

  function updateField<K extends keyof ContractFormValues>(
    key: K,
    value: ContractFormValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  const previewContract = React.useMemo(
    () => buildPreviewDomainContract(values),
    [values],
  );

  const previewAsOf = `${values.specialRepaymentUsedYear}-01-01`;

  const specialHint = React.useMemo(() => {
    if (!previewContract || values.specialRepaymentRight !== "allowed") {
      return null;
    }
    try {
      const allowance = remainingSpecialRepaymentCents(
        previewContract,
        previewAsOf,
        previewContract.currentBalanceCents,
      );
      if (allowance.flags.missingOriginalPrincipal) {
        return "Höhe unbekannt – Ursprungsbetrag fehlt.";
      }
      if (allowance.capCents === null) {
        return "Höhe nicht hinterlegt – Simulation ohne Jahresdeckel.";
      }
      const capStr = formatEuroDE(allowance.capCents);
      const remStr =
        allowance.remainingCents !== null
          ? formatEuroDE(allowance.remainingCents)
          : capStr;
      return `Entspricht ${capStr}/Jahr, frei ${remStr} (${values.specialRepaymentUsedYear}).`;
    } catch {
      return null;
    }
  }, [previewContract, previewAsOf, values.specialRepaymentRight, values.specialRepaymentUsedYear]);

  const corridorHint = React.useMemo(() => {
    if (
      !previewContract ||
      values.repaymentType === "lump_sum" ||
      values.rateChangeRight !== "allowed"
    ) {
      return null;
    }
    try {
      const corridor = resolveRateCorridor(previewContract, previewAsOf);
      if (
        corridor.flags.corridorEmpty ||
        corridor.minMonthlyCents === null ||
        corridor.maxMonthlyCents === null
      ) {
        return null;
      }
      const currentRepay = repaymentBpsFromRate(
        previewContract,
        previewContract.monthlyRateCents,
      );
      const parts = [
        `Rate ${formatEuroDE(corridor.minMonthlyCents)}–${formatEuroDE(corridor.maxMonthlyCents)}/Monat`,
      ];
      if (currentRepay !== null) {
        parts.push(`aktuell ≈ ${formatBpsDE(currentRepay.bps)} Tilgung`);
      }
      if (corridor.flags.corridorAssumed) {
        parts.push("angenommener Korridor 1–10 %");
      }
      if (corridor.flags.approximatedBase) {
        parts.push("Näherung über Restschuld");
      }
      return parts.join(" · ");
    } catch {
      return null;
    }
  }, [previewContract, previewAsOf, values.repaymentType, values.rateChangeRight]);

  const hasLoanOptionErrors = Boolean(
    errors.originalPrincipalEuro ||
      errors.specialRepaymentMaxYearlyEuro ||
      errors.specialRepaymentPercent ||
      errors.specialRepaymentUsedEuro ||
      errors.rateChangeTotalCount ||
      errors.rateChangeUsedCount ||
      errors.rateChangeMinRepaymentPercent ||
      errors.rateChangeMaxRepaymentPercent ||
      errors.rateChangeMinMonthlyEuro ||
      errors.rateChangeMaxMonthlyEuro ||
      errors.rateChangeCorridor ||
      errors.loanOptionsNote,
  );
  const isOptionsExpanded = optionsOpen || hasLoanOptionErrors;

  return (
    <div className="@container space-y-5">
      <div className="grid gap-4 @md:grid-cols-2">
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

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
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

        <div className="space-y-1.5 @md:col-span-2">
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

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-balance`}>
            {values.category === "loan" ? "Restschuld (€) *" : "Guthaben (€) *"}
          </Label>
          <Input
            id={`${idPrefix}-balance`}
            inputMode="decimal"
            value={values.currentBalanceEuro}
            onChange={(e) => updateField("currentBalanceEuro", e.target.value)}
            placeholder={
              values.category === "loan" ? "z. B. 295000,00" : "z. B. -1200,00"
            }
            hasError={Boolean(errors.currentBalanceEuro)}
            disabled={disabled}
            className="tabular-nums"
          />
          {errors.currentBalanceEuro ? (
            <p className="text-xs text-[var(--rose)]">
              {errors.currentBalanceEuro}
            </p>
          ) : values.category === "savings_contract" ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Negativ möglich, wenn die Abschlussgebühr das Guthaben ins Minus
              gebracht hat.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-date`}>Geeicht per *</Label>
          <DatePicker
            id={`${idPrefix}-date`}
            value={values.balanceAsOfDate}
            onChange={(next) => updateField("balanceAsOfDate", next)}
            hasError={Boolean(errors.balanceAsOfDate)}
            disabled={disabled}
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
          <h3 className="section-label text-[var(--text-secondary)]">
            Kredit-Konditionen
          </h3>
          <div className="grid gap-4 @md:grid-cols-2">
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
                <option value="lump_sum">
                  Endfällig (z. B. Verwandtendarlehen)
                </option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-fixed-until`}>
                Zinsbindung bis (optional)
              </Label>
              <DatePicker
                id={`${idPrefix}-fixed-until`}
                value={values.fixedInterestUntil}
                onChange={(next) => updateField("fixedInterestUntil", next)}
                hasError={Boolean(errors.fixedInterestUntil)}
                disabled={disabled}
              />
              {errors.fixedInterestUntil ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.fixedInterestUntil}
                </p>
              ) : null}
            </div>
          </div>

          {values.repaymentType === "lump_sum" ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Hinweis: Bei endfälligen Darlehen erfolgt keine automatische
              monatliche Tilgungsprojektion und kein Tilgungssatzwechsel.
            </p>
          ) : null}

          {/* Collapsible Darlehensoptionen */}
          <div
            className={`rounded-xl border p-3.5 ${
              hasPrefilledLoanOptions
                ? "border-[var(--amber)]/50 bg-[var(--amber)]/5"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <button
              type="button"
              onClick={() => setOptionsOpen((open) => !open)}
              aria-expanded={isOptionsExpanded}
              className="flex w-full items-center justify-between text-left section-label text-[var(--text-primary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
            >
              <span>Darlehensoptionen (Sondertilgung &amp; Tilgungswechsel)</span>
              <CollapseChevron open={isOptionsExpanded} className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>

            <Collapse open={isOptionsExpanded}>
              <div className="mt-4 space-y-5">
                {/* Ursprungsbetrag */}
                <div className="space-y-1.5 @md:max-w-xs">
                  <Label htmlFor={`${idPrefix}-original-principal`}>
                    Ursprungsbetrag / Nennbetrag (€, optional)
                  </Label>
                  <Input
                    id={`${idPrefix}-original-principal`}
                    inputMode="decimal"
                    value={values.originalPrincipalEuro}
                    onChange={(e) =>
                      updateField("originalPrincipalEuro", e.target.value)
                    }
                    placeholder="z. B. 300000,00"
                    hasError={Boolean(errors.originalPrincipalEuro)}
                    disabled={disabled}
                    className="tabular-nums"
                  />
                  {errors.originalPrincipalEuro ? (
                    <p className="text-xs text-[var(--rose)]">
                      {errors.originalPrincipalEuro}
                    </p>
                  ) : null}
                </div>

                {/* Sondertilgung */}
                <div className="space-y-3 border-t border-[var(--border)] pt-4">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-[var(--text-primary)]">
                      Sondertilgungsrecht
                    </span>
                    <SegmentGroup>
                      <div
                        role="group"
                        aria-label="Sondertilgungsrecht"
                        className={SEGMENT_TRACK}
                      >
                        {OPTION_RIGHT_SEGMENTS.map((seg) => {
                          const active = values.specialRepaymentRight === seg.value;
                          return (
                            <button
                              key={seg.value}
                              type="button"
                              disabled={disabled}
                              aria-pressed={active}
                              onClick={() =>
                                updateField("specialRepaymentRight", seg.value)
                              }
                              className={segmentItemClass(active)}
                            >
                              {active ? <SegmentPill /> : null}
                              <SegmentLabel>{seg.label}</SegmentLabel>
                            </button>
                          );
                        })}
                      </div>
                    </SegmentGroup>
                  </div>

                  {values.specialRepaymentRight === "allowed" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 @lg:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`${idPrefix}-sr-basis`}>
                            Deckel-Basis
                          </Label>
                          <Select
                            id={`${idPrefix}-sr-basis`}
                            value={values.specialRepaymentBasis}
                            onChange={(e) =>
                              updateField(
                                "specialRepaymentBasis",
                                e.target.value as SpecialRepaymentBasis | "",
                              )
                            }
                            disabled={disabled}
                          >
                            <option value="">Höhe nicht hinterlegt</option>
                            <option value="fixed_yearly">€ pro Jahr</option>
                            <option value="percent_original">
                              % vom Ursprungsbetrag
                            </option>
                            <option value="percent_balance">
                              % der Restschuld
                            </option>
                          </Select>
                        </div>

                        {values.specialRepaymentBasis === "fixed_yearly" ? (
                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-special-repayment`}>
                              Sondertilgung/Jahr (€)
                            </Label>
                            <Input
                              id={`${idPrefix}-special-repayment`}
                              inputMode="decimal"
                              value={values.specialRepaymentMaxYearlyEuro}
                              onChange={(e) =>
                                updateField(
                                  "specialRepaymentMaxYearlyEuro",
                                  e.target.value,
                                )
                              }
                              placeholder="z. B. 10000,00"
                              hasError={Boolean(
                                errors.specialRepaymentMaxYearlyEuro,
                              )}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.specialRepaymentMaxYearlyEuro ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.specialRepaymentMaxYearlyEuro}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {values.specialRepaymentBasis === "percent_original" ||
                        values.specialRepaymentBasis === "percent_balance" ? (
                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-sr-percent`}>
                              Prozentsatz (%)
                            </Label>
                            <Input
                              id={`${idPrefix}-sr-percent`}
                              inputMode="decimal"
                              value={values.specialRepaymentPercent}
                              onChange={(e) =>
                                updateField(
                                  "specialRepaymentPercent",
                                  e.target.value,
                                )
                              }
                              placeholder="z. B. 5,00"
                              hasError={Boolean(errors.specialRepaymentPercent)}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.specialRepaymentPercent ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.specialRepaymentPercent}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="space-y-1.5">
                          <Label htmlFor={`${idPrefix}-sr-used`}>
                            Bereits genutzt in {values.specialRepaymentUsedYear}{" "}
                            (€)
                          </Label>
                          <Input
                            id={`${idPrefix}-sr-used`}
                            inputMode="decimal"
                            value={values.specialRepaymentUsedEuro}
                            onChange={(e) =>
                              updateField(
                                "specialRepaymentUsedEuro",
                                e.target.value,
                              )
                            }
                            placeholder="0,00"
                            hasError={Boolean(errors.specialRepaymentUsedEuro)}
                            disabled={disabled}
                            className="tabular-nums"
                          />
                          {errors.specialRepaymentUsedEuro ? (
                            <p className="text-xs text-[var(--rose)]">
                              {errors.specialRepaymentUsedEuro}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-0.5 text-xs text-[var(--text-secondary)]">
                        {specialHint ? (
                          <p className="tabular-nums font-medium text-[var(--text-primary)]">
                            {specialHint}
                          </p>
                        ) : null}
                        <p>
                          Kontingent je Kalenderjahr gerechnet
                          {values.specialRepaymentBasis === "percent_balance"
                            ? " (Restschuld zu Jahresbeginn)."
                            : "."}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Tilgungssatzwechsel (nur bei nicht-endfälligen Krediten) */}
                {values.repaymentType !== "lump_sum" ? (
                  <div className="space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="space-y-1.5">
                      <span className="block text-xs font-medium text-[var(--text-primary)]">
                        Tilgungssatzwechsel
                      </span>
                      <SegmentGroup>
                        <div
                          role="group"
                          aria-label="Tilgungssatzwechsel"
                          className={SEGMENT_TRACK}
                        >
                          {OPTION_RIGHT_SEGMENTS.map((seg) => {
                            const active = values.rateChangeRight === seg.value;
                            return (
                              <button
                                key={seg.value}
                                type="button"
                                disabled={disabled}
                                aria-pressed={active}
                                onClick={() =>
                                  updateField("rateChangeRight", seg.value)
                                }
                                className={segmentItemClass(active)}
                              >
                                {active ? <SegmentPill /> : null}
                                <SegmentLabel>{seg.label}</SegmentLabel>
                              </button>
                            );
                          })}
                        </div>
                      </SegmentGroup>
                    </div>

                    {values.rateChangeRight === "allowed" ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 @lg:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-count`}>
                              Erlaubte Wechsel (optional)
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-count`}
                              inputMode="numeric"
                              value={values.rateChangeTotalCount}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeTotalCount",
                                  e.target.value,
                                )
                              }
                              placeholder="z. B. 2"
                              hasError={Boolean(errors.rateChangeTotalCount)}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeTotalCount ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeTotalCount}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-scope`}>Bezug</Label>
                            <Select
                              id={`${idPrefix}-rc-scope`}
                              value={values.rateChangeScope}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeScope",
                                  e.target.value as RateChangeScope | "",
                                )
                              }
                              disabled={disabled}
                            >
                              <option value="">Nicht festgelegt</option>
                              <option value="term">Gesamtlaufzeit</option>
                              <option value="fixed_period">
                                je Zinsbindung
                              </option>
                              <option value="per_year">pro Jahr</option>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-used`}>
                              Bereits genutzt
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-used`}
                              inputMode="numeric"
                              value={values.rateChangeUsedCount}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeUsedCount",
                                  e.target.value,
                                )
                              }
                              placeholder="0"
                              hasError={Boolean(errors.rateChangeUsedCount)}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeUsedCount ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeUsedCount}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid gap-3 @md:grid-cols-2 @xl:grid-cols-4">
                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-min-bps`}>
                              Tilgung Min (%)
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-min-bps`}
                              inputMode="decimal"
                              value={values.rateChangeMinRepaymentPercent}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeMinRepaymentPercent",
                                  e.target.value,
                                )
                              }
                              placeholder="z. B. 1,00"
                              hasError={Boolean(
                                errors.rateChangeMinRepaymentPercent,
                              )}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeMinRepaymentPercent ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeMinRepaymentPercent}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-max-bps`}>
                              Tilgung Max (%)
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-max-bps`}
                              inputMode="decimal"
                              value={values.rateChangeMaxRepaymentPercent}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeMaxRepaymentPercent",
                                  e.target.value,
                                )
                              }
                              placeholder="z. B. 5,00"
                              hasError={Boolean(
                                errors.rateChangeMaxRepaymentPercent,
                              )}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeMaxRepaymentPercent ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeMaxRepaymentPercent}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-min-eur`}>
                              Rate Min (€)
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-min-eur`}
                              inputMode="decimal"
                              value={values.rateChangeMinMonthlyEuro}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeMinMonthlyEuro",
                                  e.target.value,
                                )
                              }
                              placeholder="optional"
                              hasError={Boolean(errors.rateChangeMinMonthlyEuro)}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeMinMonthlyEuro ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeMinMonthlyEuro}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-rc-max-eur`}>
                              Rate Max (€)
                            </Label>
                            <Input
                              id={`${idPrefix}-rc-max-eur`}
                              inputMode="decimal"
                              value={values.rateChangeMaxMonthlyEuro}
                              onChange={(e) =>
                                updateField(
                                  "rateChangeMaxMonthlyEuro",
                                  e.target.value,
                                )
                              }
                              placeholder="optional"
                              hasError={Boolean(errors.rateChangeMaxMonthlyEuro)}
                              disabled={disabled}
                              className="tabular-nums"
                            />
                            {errors.rateChangeMaxMonthlyEuro ? (
                              <p className="text-xs text-[var(--rose)]">
                                {errors.rateChangeMaxMonthlyEuro}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {errors.rateChangeCorridor ? (
                          <p className="text-xs font-medium text-[var(--rose)]">
                            {errors.rateChangeCorridor}
                          </p>
                        ) : null}

                        {corridorHint ? (
                          <p className="tabular-nums text-xs font-medium text-[var(--text-primary)]">
                            {corridorHint}
                          </p>
                        ) : null}
                        {values.rateChangeScope === "per_year" ? (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Bei jährlichem Bezug wird die Nutzung im laufenden
                            Jahr nicht separat gezählt.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Notiz */}
                <div className="space-y-1.5 border-t border-[var(--border)] pt-4">
                  <Label htmlFor={`${idPrefix}-loan-note`}>
                    Vertragsnotiz (optional, max. 500 Zeichen)
                  </Label>
                  <textarea
                    id={`${idPrefix}-loan-note`}
                    rows={2}
                    maxLength={500}
                    value={values.loanOptionsNote}
                    onChange={(e) =>
                      updateField("loanOptionsNote", e.target.value)
                    }
                    disabled={disabled}
                    placeholder="z. B. Sondertilgung nur zum 31.12., Wechsel 2× kostenlos"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
                  />
                  {errors.loanOptionsNote ? (
                    <p className="text-xs text-[var(--rose)]">
                      {errors.loanOptionsNote}
                    </p>
                  ) : null}
                  <p className="text-2xs text-[var(--text-secondary)]">
                    Bleibt lokal, nicht im anonymisierten Bericht.
                  </p>
                </div>
              </div>
            </Collapse>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
          <h3 className="section-label text-[var(--text-secondary)]">
            Bauspar-Konditionen
          </h3>
          <div className="grid gap-4 @lg:grid-cols-3">
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

      <div className="grid gap-4 @md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-milestone-date`}>
            Meilenstein-Datum (optional)
          </Label>
          <DatePicker
            id={`${idPrefix}-milestone-date`}
            value={values.milestoneDate}
            onChange={(next) => updateField("milestoneDate", next)}
            hasError={Boolean(errors.milestoneDate)}
            disabled={disabled}
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
