import { z } from "zod";
import { daysInMonth, parseIsoDate } from "@/domain/core/date";
import type {
  PropertyPurchaseInput,
  PropertyPurchaseResult,
} from "@/domain/planning/purchase";
import { PROPERTY_PURCHASE_LIMITS } from "@/domain/planning/purchase-defaults";
import {
  coerceStrictInt,
  getParam,
  type RawSearchParams,
} from "./query-params";

export type { RawSearchParams };

export const purchaseDraftQuerySchema = z.object({
  entwurf: z.literal("kaufrechner"),
  kp: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.purchasePriceCents.min,
    PROPERTY_PURCHASE_LIMITS.purchasePriceCents.max,
  ),
  miete: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.monthlyColdRentCents.min,
    PROPERTY_PURCHASE_LIMITS.monthlyColdRentCents.max,
  ).default(0),
  nuk: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.monthlyNonRecoverableCostsCents.min,
    PROPERTY_PURCHASE_LIMITS.monthlyNonRecoverableCostsCents.max,
  ).default(0),
  ihr: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.monthlyMaintenanceCents.min,
    PROPERTY_PURCHASE_LIMITS.monthlyMaintenanceCents.max,
  ).default(0),
  darlehen: coerceStrictInt(
    0,
    PROPERTY_PURCHASE_LIMITS.purchasePriceCents.max,
  ).default(0),
  rate: coerceStrictInt(0, 10_000_000).default(0),
  zins: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.interestRateBps.min,
    PROPERTY_PURCHASE_LIMITS.interestRateBps.max,
  ).default(0),
  zb: coerceStrictInt(
    PROPERTY_PURCHASE_LIMITS.fixedRateYears.min,
    PROPERTY_PURCHASE_LIMITS.fixedRateYears.max,
  )
    .nullable()
    .optional(),
});

export interface PurchaseDraft {
  purchasePriceCents: number;
  monthlyColdRentCents: number;
  monthlyNonRecoverableCostsCents: number;
  monthlyMaintenanceAllowanceCents: number;
  loanAmountCents: number;
  monthlyRateCents: number;
  interestRateBps: number;
  fixedRateYears: number | null;
}

export interface PurchaseDraftParseResult {
  draft: PurchaseDraft | null;
  reason: string | null;
}

/**
 * Parst Query-Parameter aus dem Kaufrechner-Entwurf.
 * Enthält ausschließlich numerische Werte (keine Adresse, kein Name).
 */
export function parsePurchaseDraft(
  searchParams: RawSearchParams,
): PurchaseDraftParseResult {
  const entwurf = getParam(searchParams, "entwurf");
  if (entwurf === undefined) {
    return { draft: null, reason: null };
  }

  const candidate = {
    entwurf,
    kp: getParam(searchParams, "kp"),
    miete: getParam(searchParams, "miete"),
    nuk: getParam(searchParams, "nuk"),
    ihr: getParam(searchParams, "ihr"),
    darlehen: getParam(searchParams, "darlehen"),
    rate: getParam(searchParams, "rate"),
    zins: getParam(searchParams, "zins"),
    zb: getParam(searchParams, "zb"),
  };

  const parsed = purchaseDraftQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      draft: null,
      reason: "Entwurf aus dem Kaufrechner war ungültig und wurde verworfen.",
    };
  }

  return {
    draft: {
      purchasePriceCents: parsed.data.kp,
      monthlyColdRentCents: parsed.data.miete,
      monthlyNonRecoverableCostsCents: parsed.data.nuk,
      monthlyMaintenanceAllowanceCents: parsed.data.ihr,
      loanAmountCents: parsed.data.darlehen,
      monthlyRateCents: parsed.data.rate,
      interestRateBps: parsed.data.zins,
      fixedRateYears: parsed.data.zb ?? null,
    },
    reason: null,
  };
}

/**
 * Erzeugt die Query-Parameter für den Link „Als Objekt anlegen“ im Kaufrechner.
 * Enthält ausschließlich numerische Werte (keine Adresse, kein Name).
 */
export function buildPurchaseDraftSearchParams(
  input: Pick<
    PropertyPurchaseInput,
    | "purchasePriceCents"
    | "monthlyColdRentCents"
    | "monthlyNonRecoverableCostsCents"
    | "monthlyMaintenanceCents"
    | "interestRateBps"
    | "fixedRateYears"
  >,
  result: Pick<PropertyPurchaseResult, "loan">,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("entwurf", "kaufrechner");
  params.set("kp", String(input.purchasePriceCents));
  params.set("miete", String(input.monthlyColdRentCents));
  params.set("nuk", String(input.monthlyNonRecoverableCostsCents));
  params.set("ihr", String(input.monthlyMaintenanceCents));
  params.set("darlehen", String(result.loan.principalCents));
  params.set("rate", String(result.loan.monthlyRateCents));
  params.set("zins", String(input.interestRateBps));
  params.set("zb", String(input.fixedRateYears));
  return params;
}

export interface ContractLoanDraft {
  category: "loan";
  repaymentType: "annuity";
  currentBalanceCents: number;
  monthlyRateCents: number;
  interestRateBps: number;
  linkedPropertyId: string;
  balanceAsOfDate: string;
  fixedInterestUntil: string | null;
}

/**
 * Mappt einen Kaufrechner-Entwurf auf ein vorbefülltes Objektkredit-Formular (ohne Speichern).
 */
export function buildLoanDraftFromPurchase(
  draft: PurchaseDraft,
  propertyId: string,
  todayIso: string,
): ContractLoanDraft | null {
  if (draft.loanAmountCents <= 0) {
    return null;
  }

  const today = parseIsoDate(todayIso, "todayIso");
  let fixedInterestUntil: string | null = null;
  if (draft.fixedRateYears != null) {
    const targetYear = today.year + draft.fixedRateYears;
    const clampedDay = Math.min(today.day, daysInMonth(targetYear, today.month));
    fixedInterestUntil = `${String(targetYear).padStart(4, "0")}-${String(today.month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
  }

  return {
    category: "loan",
    repaymentType: "annuity",
    currentBalanceCents: draft.loanAmountCents,
    monthlyRateCents: draft.monthlyRateCents,
    interestRateBps: draft.interestRateBps,
    linkedPropertyId: propertyId,
    balanceAsOfDate: todayIso,
    fixedInterestUntil,
  };
}
