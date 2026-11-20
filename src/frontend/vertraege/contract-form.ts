import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { ContractCategory, ContractStatus, DomainContract, RepaymentType } from "@/domain/contracts/contract";
import type { OptionRight, RateChangeScope, SpecialRepaymentBasis } from "@/domain/contracts/loan-options";
import type { ContractPrefillResult } from "@/domain/contracts/prefill";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/domain/core/money";
import { contractCreateSchema, type ContractCreateInput } from "@/validation/contracts";

/**
 * Formularzustand eines Vertrags: alle Eingaben als Text, so wie getippt.
 * Die fachlichen Regeln prüft ausschließlich `contractCreateSchema` – dasselbe
 * Schema, das auch der Server anwendet. Hier wird nur Text in Zahlen übersetzt.
 */
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
  /** Kalenderjahr, auf das sich „bereits genutzt“ bezieht (nicht editierbar). */
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

type NumberKind = "euro" | "percent" | "int";

/** Zahlfelder: Formularfeld → [Feld im Payload, Eingabeformat]. */
const NUMBER_FIELDS = {
  currentBalanceEuro: ["currentBalanceCents", "euro"],
  monthlyRateEuro: ["monthlyRateCents", "euro"],
  interestRatePercent: ["interestRateBps", "percent"],
  originalPrincipalEuro: ["originalPrincipalCents", "euro"],
  specialRepaymentMaxYearlyEuro: ["specialRepaymentMaxYearlyCents", "euro"],
  specialRepaymentPercent: ["specialRepaymentPercentBps", "percent"],
  specialRepaymentUsedEuro: ["specialRepaymentUsedCents", "euro"],
  rateChangeTotalCount: ["rateChangeTotalCount", "int"],
  rateChangeUsedCount: ["rateChangeUsedCount", "int"],
  rateChangeMinRepaymentPercent: ["rateChangeMinRepaymentBps", "percent"],
  rateChangeMaxRepaymentPercent: ["rateChangeMaxRepaymentBps", "percent"],
  rateChangeMinMonthlyEuro: ["rateChangeMinMonthlyCents", "euro"],
  rateChangeMaxMonthlyEuro: ["rateChangeMaxMonthlyCents", "euro"],
  targetSumEuro: ["targetSumCents", "euro"],
  allocationThresholdPercent: ["allocationThresholdPercent", "int"],
  futureLoanInterestRatePercent: ["futureLoanInterestRateBps", "percent"],
} as const satisfies Partial<Record<keyof ContractFormValues, readonly [keyof ContractCreateInput, NumberKind]>>;

type NumberField = keyof typeof NUMBER_FIELDS;
const REQUIRED_NUMBERS: readonly NumberField[] = ["currentBalanceEuro", "monthlyRateEuro", "interestRatePercent"];

/** Fehler je Formularfeld; `rateChangeCorridor` und `general` haben kein eigenes Feld. */
export type ContractFieldErrors = Partial<Record<keyof ContractFormValues | "rateChangeCorridor" | "general", string>>;

export type ContractPayload = Record<string, unknown>;

function toInput(kind: NumberKind, value: number | null | undefined): string {
  if (value == null) return "";
  if (kind === "euro") return centsToEuroInputString(value);
  if (kind === "percent") return bpsToPercentInputString(value);
  return String(value);
}

function parseNumber(kind: NumberKind, raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed =
    kind === "euro" ? parseEuroInputToCents(trimmed) : kind === "percent" ? parsePercentInputToBps(trimmed) : Number(trimmed);
  return parsed === null || !Number.isInteger(parsed) ? "invalid" : parsed;
}

const INVALID_NUMBER: Record<NumberKind, string> = {
  euro: "Bitte einen gültigen Betrag eingeben (z. B. 1200,50).",
  percent: "Bitte einen gültigen Prozentwert eingeben (z. B. 3,50).",
  int: "Bitte eine ganze Zahl eingeben.",
};

/** Felder, die für die aktuelle Auswahl sichtbar sind und mitgesendet werden. */
function isRelevant(field: NumberField, values: ContractFormValues): boolean {
  const loan = values.category === "loan";
  const specialAllowed = loan && values.specialRepaymentRight === "allowed";
  const rateChangeAllowed = loan && values.rateChangeRight === "allowed" && values.repaymentType !== "lump_sum";
  switch (field) {
    case "originalPrincipalEuro":
    case "specialRepaymentUsedEuro":
      return loan;
    case "specialRepaymentMaxYearlyEuro":
      return specialAllowed && values.specialRepaymentBasis === "fixed_yearly";
    case "specialRepaymentPercent":
      return specialAllowed && values.specialRepaymentBasis.startsWith("percent_");
    case "rateChangeTotalCount":
    case "rateChangeUsedCount":
    case "rateChangeMinRepaymentPercent":
    case "rateChangeMaxRepaymentPercent":
    case "rateChangeMinMonthlyEuro":
    case "rateChangeMaxMonthlyEuro":
      return rateChangeAllowed;
    case "targetSumEuro":
    case "allocationThresholdPercent":
    case "futureLoanInterestRatePercent":
      return !loan;
    default:
      return true;
  }
}

function yearFromIsoDate(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : 2026;
}

export function hasPopulatedLoanOptions(values: ContractFormValues): boolean {
  return (
    values.originalPrincipalEuro.trim() !== "" ||
    values.specialRepaymentRight !== "unknown" ||
    values.specialRepaymentUsedEuro.trim() !== "" ||
    values.rateChangeRight !== "unknown" ||
    values.loanOptionsNote.trim() !== ""
  );
}

function numberInputsFrom(source: object, fields: readonly NumberField[]) {
  const record = source as Record<string, number | null | undefined>;
  return Object.fromEntries(fields.map((field) => [field, toInput(NUMBER_FIELDS[field][1], record[NUMBER_FIELDS[field][0]])]));
}

const ALL_NUMBER_FIELDS = Object.keys(NUMBER_FIELDS) as NumberField[];

export function createInitialContractFormValues(contract: FinancialContractRow | null | undefined, asOfDate: string): ContractFormValues {
  const currentYear = yearFromIsoDate(asOfDate);
  return {
    name: contract?.name ?? "",
    provider: contract?.provider ?? "",
    category: contract?.category ?? "loan",
    status: contract?.status ?? "active",
    linkedPropertyId: contract?.linkedPropertyId ?? "",
    balanceAsOfDate: contract?.balanceAsOfDate ?? asOfDate,
    milestoneDate: contract?.milestoneDate ?? "",
    milestoneLabel: contract?.milestoneLabel ?? "",
    repaymentType: contract?.repaymentType ?? "annuity",
    fixedInterestUntil: contract?.fixedInterestUntil ?? "",
    specialRepaymentRight: contract?.specialRepaymentRight ?? "unknown",
    specialRepaymentBasis: contract?.specialRepaymentBasis ?? "",
    rateChangeRight: contract?.rateChangeRight ?? "unknown",
    rateChangeScope: contract?.rateChangeScope ?? "",
    loanOptionsNote: contract?.loanOptionsNote ?? "",
    ...(numberInputsFrom(contract ?? {}, ALL_NUMBER_FIELDS) as Record<NumberField, string>),
    ...(contract ? {} : { monthlyRateEuro: "0,00", interestRatePercent: "0,00" }),
    // „Bereits genutzt“ gilt nur für das laufende Jahr.
    specialRepaymentUsedEuro:
      contract?.specialRepaymentUsedYear === currentYear ? toInput("euro", contract.specialRepaymentUsedCents) : "",
    specialRepaymentUsedYear: currentYear,
    rateChangeUsedCount: String(contract?.rateChangeUsedCount ?? 0),
  };
}

/** Übernimmt einen KI-Vorschlag; Nutzungszähler, Status und Verknüpfung bleiben. */
export function applyPrefillToContractFormValues(current: ContractFormValues, prefill: ContractPrefillResult): ContractFormValues {
  const { values } = prefill;
  const prefilled = ALL_NUMBER_FIELDS.filter((field) => NUMBER_FIELDS[field][0] in values);
  return {
    ...current,
    ...(numberInputsFrom(values, prefilled) as Partial<Record<NumberField, string>>),
    name: values.name ?? "",
    provider: values.provider ?? "",
    category: values.category,
    balanceAsOfDate: values.balanceAsOfDate,
    repaymentType: values.repaymentType,
    fixedInterestUntil: values.fixedInterestUntil ?? "",
    specialRepaymentRight: values.specialRepaymentRight,
    specialRepaymentBasis: values.specialRepaymentBasis ?? "",
    rateChangeRight: values.rateChangeRight,
    rateChangeScope: values.rateChangeScope ?? "",
    milestoneDate: values.milestoneDate ?? "",
    milestoneLabel: values.milestoneLabel ?? "",
  };
}

/** Payload-Feld → Formularfeld (für Fehler vom Schema bzw. vom Server). */
const FORM_FIELD_BY_PAYLOAD_KEY: Record<string, keyof ContractFieldErrors> = {
  ...Object.fromEntries(ALL_NUMBER_FIELDS.map((field) => [NUMBER_FIELDS[field][0], field])),
  specialRepaymentUsedYear: "specialRepaymentUsedEuro",
};

/** Fehler vom Schema/Server (`fieldErrors` mit Payload-Namen) auf Formularfelder abbilden. */
export function mapApiFieldErrorsToContractErrors(error?: string, fieldErrors: Record<string, string> = {}): ContractFieldErrors {
  const errors: ContractFieldErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const key = path.replace(/^contract\./, "");
    const field = FORM_FIELD_BY_PAYLOAD_KEY[key] ?? (key as keyof ContractFieldErrors);
    errors[field] ??= message;
  }
  if (error !== undefined || Object.keys(errors).length === 0) errors.general = error ?? "Speichern fehlgeschlagen.";
  return errors;
}

/** Text → Payload; Syntaxfehler (keine Zahl) werden hier gemeldet. */
function buildRawPayload(values: ContractFormValues): { payload: ContractPayload; errors: ContractFieldErrors } {
  const errors: ContractFieldErrors = {};
  const numbers: Record<string, number | null> = {};
  for (const field of ALL_NUMBER_FIELDS) {
    const [payloadKey, kind] = NUMBER_FIELDS[field];
    const parsed = isRelevant(field, values) ? parseNumber(kind, values[field]) : null;
    if (parsed === "invalid") errors[field] = INVALID_NUMBER[kind];
    else if (parsed === null && REQUIRED_NUMBERS.includes(field)) errors[field] = "Bitte einen Wert eingeben.";
    numbers[payloadKey] = parsed === "invalid" ? null : parsed;
  }
  if (!values.name.trim()) errors.name = "Bitte einen Vertragsnamen eingeben.";
  if (!values.balanceAsOfDate.trim()) errors.balanceAsOfDate = "Bitte das Stichtagsdatum angeben.";

  const usedCents = numbers.specialRepaymentUsedCents;
  const payload: ContractPayload = {
    ...numbers,
    rateChangeUsedCount: numbers.rateChangeUsedCount ?? 0,
    specialRepaymentUsedYear: usedCents != null ? values.specialRepaymentUsedYear : null,
    name: values.name.trim(),
    provider: values.provider.trim() || null,
    category: values.category,
    status: values.status,
    balanceAsOfDate: values.balanceAsOfDate.trim(),
    linkedPropertyId: values.linkedPropertyId || null,
    milestoneDate: values.milestoneDate.trim() || null,
    milestoneLabel: values.milestoneLabel.trim() || null,
    ...(values.category === "loan"
      ? {
          repaymentType: values.repaymentType,
          fixedInterestUntil: values.fixedInterestUntil.trim() || null,
          specialRepaymentRight: values.specialRepaymentRight,
          specialRepaymentBasis: values.specialRepaymentBasis || null,
          rateChangeRight: values.rateChangeRight,
          rateChangeScope: values.rateChangeScope || null,
          loanOptionsNote: values.loanOptionsNote.trim() || null,
        }
      : {}),
  };
  return { payload, errors };
}

export function validateAndBuildContractPayload(
  values: ContractFormValues,
): { ok: true; payload: ContractPayload } | { ok: false; errors: ContractFieldErrors } {
  const { payload, errors } = buildRawPayload(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const parsed = contractCreateSchema.safeParse(payload);
  if (parsed.success) return { ok: true, payload };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "general"] ??= issue.message;
  const { general: _general, ...mapped } = mapApiFieldErrorsToContractErrors(undefined, fieldErrors);
  void _general;
  return { ok: false, errors: Object.keys(mapped).length > 0 ? mapped : { general: "Bitte die Eingaben prüfen." } };
}

/** Vertrag aus dem aktuellen Formular für Live-Hinweise – nur, wenn alles gültig ist. */
export function previewLoanContract(values: ContractFormValues): DomainContract | null {
  if (values.category !== "loan") return null;
  const { payload, errors } = buildRawPayload(values);
  if (Object.keys(errors).length > 0) return null;
  const parsed = contractCreateSchema.safeParse(payload);
  return parsed.success ? { id: "preview", ...parsed.data } : null;
}
