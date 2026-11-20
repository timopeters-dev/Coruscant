import { z } from "zod";
import { AUTO_VALUATION_INTERVALS } from "@/domain/properties/valuation/auto-schedule";
import { getTodayIsoDate, parseIsoDate } from "@/domain/core/date";
import { MAX_RATE_CHANGE_COUNT, type OptionRight, type RateChangeScope, type SpecialRepaymentBasis } from "@/domain/contracts/loan-options";
import { resolveRateCorridor } from "@/domain/contracts/loan-allowances";
import {
  MAX_RENOVATIONS,
  RENOVATION_KINDS,
  type Renovation,
} from "@/domain/properties/renovations";
import { PROPERTY_TYPES } from "@/domain/properties/types";
import { PROPERTY_PURCHASE_LIMITS } from "@/domain/planning/purchase-defaults";
import { validateRentalProfile } from "@/domain/properties/rental";

export const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

/** Ganzzahl im sicheren Bereich, auch negativ (z. B. Bauspar-Saldo nach Abschlussgebühr). */
export const signedSafeInt = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const basisPointsSchema = z.number().int().nonnegative().max(100_000);

export const isoDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    try {
      parseIsoDate(value, "date");
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Ungültiges Kalenderdatum (erwartet JJJJ-MM-TT).",
      });
    }
  });

function emptyStringToNull(value: unknown): unknown {
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }
  return value;
}

export function nullableOptionalTrimmedString(maxLength = 120) {
  return z.preprocess(
    emptyStringToNull,
    z.string().trim().min(1).max(maxLength).nullable().optional(),
  );
}

export const nullableOptionalIsoDate = z.preprocess(
  emptyStringToNull,
  isoDateSchema.nullable().optional(),
);

export const propertyUsageSchema = z.enum(["owner_occupied", "rented"]);
export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export const autoValuationIntervalSchema = z.enum(AUTO_VALUATION_INTERVALS);

const nullableOptionalPropertyType = z.preprocess(
  emptyStringToNull,
  propertyTypeSchema.nullable().optional(),
);

export const PROPERTY_ENERGY_CLASSES = [
  "A+",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
] as const;

export type PropertyEnergyClass = (typeof PROPERTY_ENERGY_CLASSES)[number];

export const propertyEnergyClassSchema = z.enum(PROPERTY_ENERGY_CLASSES);

const nullableOptionalPositiveAreaSqm = z
  .number()
  .int()
  .min(1, "Fläche muss mindestens 1 m² betragen.")
  .max(1_000_000, "Fläche darf höchstens 1.000.000 m² betragen.")
  .nullable()
  .optional();

const nullableOptionalConstructionYear = z
  .number()
  .int()
  .min(1500, "Baujahr muss zwischen 1500 und 2100 liegen.")
  .max(2100, "Baujahr muss zwischen 1500 und 2100 liegen.")
  .nullable()
  .optional();

const nullableOptionalEnergyClass = z.preprocess(
  emptyStringToNull,
  propertyEnergyClassSchema.nullable().optional(),
);

const propertyRenovationItemSchema = z
  .object({
    year: z
      .number()
      .int()
      .min(1800, "Sanierungsjahr muss zwischen 1800 und 2100 liegen.")
      .max(2100, "Sanierungsjahr muss zwischen 1800 und 2100 liegen."),
    kind: z.enum(RENOVATION_KINDS),
  })
  .strict();

export const propertyRenovationsSchema = z
  .array(propertyRenovationItemSchema)
  .max(MAX_RENOVATIONS, `Höchstens ${MAX_RENOVATIONS} Sanierungen erlaubt.`)
  .nullable()
  .optional();

function addRenovationValidationIssues(
  renovations: Renovation[] | null | undefined,
  constructionYear: number | null | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!renovations || renovations.length === 0) {
    return;
  }
  const currentYear = Number(getTodayIsoDate().slice(0, 4));
  const seen = new Set<string>();
  for (let i = 0; i < renovations.length; i++) {
    const item = renovations[i];
    if (!item) continue;
    if (item.year > currentYear) {
      ctx.addIssue({
        code: "custom",
        path: ["renovations", i, "year"],
        message: `Sanierungsjahr darf nicht in der Zukunft liegen (max. ${currentYear}).`,
      });
    }
    if (constructionYear != null && item.year < constructionYear) {
      ctx.addIssue({
        code: "custom",
        path: ["renovations", i, "year"],
        message: `Sanierungsjahr darf nicht vor dem Baujahr (${constructionYear}) liegen.`,
      });
    }
    const key = `${item.year}:${item.kind}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["renovations", i],
        message: "Doppelte Sanierung (Jahr und Art).",
      });
    }
    seen.add(key);
  }
}

const propertyMetadataFields = {
  street: nullableOptionalTrimmedString(120),
  houseNumber: nullableOptionalTrimmedString(20),
  postalCode: nullableOptionalTrimmedString(12),
  city: nullableOptionalTrimmedString(120),
  livingAreaSqm: nullableOptionalPositiveAreaSqm,
  usableAreaSqm: nullableOptionalPositiveAreaSqm,
  plotAreaSqm: nullableOptionalPositiveAreaSqm,
  constructionYear: nullableOptionalConstructionYear,
  energyClass: nullableOptionalEnergyClass,
  renovations: propertyRenovationsSchema,
  features: nullableOptionalTrimmedString(500),
};

const rentalProfileFields = {
  monthlyColdRentCents: nonNegativeSafeInt
    .max(
      PROPERTY_PURCHASE_LIMITS.monthlyColdRentCents.max,
      "Kaltmiete darf höchstens 100.000,00 € pro Monat betragen.",
    )
    .nullable()
    .optional(),
  monthlyNonRecoverableCostsCents: nonNegativeSafeInt
    .max(
      PROPERTY_PURCHASE_LIMITS.monthlyNonRecoverableCostsCents.max,
      "Nicht umlagefähige Kosten dürfen höchstens 100.000,00 € pro Monat betragen.",
    )
    .nullable()
    .optional(),
  monthlyMaintenanceAllowanceCents: nonNegativeSafeInt
    .max(
      PROPERTY_PURCHASE_LIMITS.monthlyMaintenanceCents.max,
      "Instandhaltungs-Rücklage darf höchstens 100.000,00 € pro Monat betragen.",
    )
    .nullable()
    .optional(),
  depreciationBasisCents: nonNegativeSafeInt
    .max(
      10_000_000_000,
      "AfA-Bemessungsgrundlage darf höchstens 100.000.000,00 € betragen.",
    )
    .nullable()
    .optional(),
};

export const propertyCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    usage: propertyUsageSchema.default("owner_occupied"),
    propertyType: nullableOptionalPropertyType,
    autoValuationInterval: autoValuationIntervalSchema.optional(),
    purchaseDate: nullableOptionalIsoDate,
    purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
    estimatedValueCents: nonNegativeSafeInt,
    estimatedValueAsOf: nullableOptionalIsoDate,
    maintenanceReservePotId: nullableOptionalTrimmedString(120),
    ...rentalProfileFields,
    ...propertyMetadataFields,
  })
  .superRefine((data, ctx) => {
    const errors = validateRentalProfile(data.usage, data);
    for (const [field, message] of Object.entries(errors)) {
      if (message) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message,
        });
      }
    }
    addRenovationValidationIssues(data.renovations, data.constructionYear, ctx);
  });

export const propertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    usage: propertyUsageSchema,
    propertyType: nullableOptionalPropertyType,
    autoValuationInterval: autoValuationIntervalSchema,
    estimatedValueSource: z.never({
      message: "estimatedValueSource darf nicht manuell gesetzt werden.",
    }),
    valuationAdjustments: z.never({
      message:
        "valuationAdjustments dürfen nur über die Korrektur-Route geändert werden.",
    }),
    purchaseDate: nullableOptionalIsoDate,
    purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
    estimatedValueCents: nonNegativeSafeInt,
    estimatedValueAsOf: nullableOptionalIsoDate,
    maintenanceReservePotId: nullableOptionalTrimmedString(120),
    ...rentalProfileFields,
    ...propertyMetadataFields,
  })
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  )
  .superRefine((data, ctx) => {
    addRenovationValidationIssues(data.renovations, data.constructionYear, ctx);
  });

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const contractCategorySchema = z.enum(["loan", "savings_contract"]);
export const contractStatusSchema = z.enum(["active", "paused", "closed"]);
export const repaymentTypeSchema = z.enum([
  "annuity",
  "installment",
  "lump_sum",
]);
export const optionRightSchema = z.enum(["unknown", "none", "allowed"]);
export const specialRepaymentBasisSchema = z.enum([
  "fixed_yearly",
  "percent_original",
  "percent_balance",
]);
export const rateChangeScopeSchema = z.enum([
  "term",
  "fixed_period",
  "per_year",
]);

const nullableOptionalPositiveSafeInt = z
  .number()
  .int()
  .min(1, "Betrag muss größer als 0 sein.")
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional();

const nullableOptionalSpecialPercentBps = z
  .number()
  .int()
  .min(1, "Prozentsatz muss größer als 0 % sein.")
  .max(10_000, "Prozentsatz darf höchstens 100 % betragen.")
  .nullable()
  .optional();

const nullableOptionalRepaymentCorridorBps = z
  .number()
  .int()
  .min(0, "Tilgungssatz darf nicht negativ sein.")
  .max(10_000, "Tilgungssatz darf höchstens 100 % betragen.")
  .nullable()
  .optional();

const nullableOptionalUsedYear = z
  .number()
  .int()
  .min(1900, "Jahr muss zwischen 1900 und 2200 liegen.")
  .max(2200, "Jahr muss zwischen 1900 und 2200 liegen.")
  .nullable()
  .optional();

const nullableOptionalRateChangeCount = z
  .number()
  .int()
  .min(1, "Anzahl muss mindestens 1 sein.")
  .max(
    MAX_RATE_CHANGE_COUNT,
    `Höchstens ${MAX_RATE_CHANGE_COUNT} Wechsel möglich.`,
  )
  .nullable()
  .optional();

export const loanOptionSchemaFields = {
  originalPrincipalCents: nullableOptionalPositiveSafeInt,
  specialRepaymentRight: optionRightSchema.optional(),
  specialRepaymentBasis: specialRepaymentBasisSchema.nullable().optional(),
  specialRepaymentMaxYearlyCents: nonNegativeSafeInt.nullable().optional(),
  specialRepaymentPercentBps: nullableOptionalSpecialPercentBps,
  specialRepaymentUsedCents: nonNegativeSafeInt.nullable().optional(),
  specialRepaymentUsedYear: nullableOptionalUsedYear,
  rateChangeRight: optionRightSchema.optional(),
  rateChangeTotalCount: nullableOptionalRateChangeCount,
  rateChangeScope: rateChangeScopeSchema.nullable().optional(),
  rateChangeUsedCount: nonNegativeSafeInt.optional(),
  rateChangeMinRepaymentBps: nullableOptionalRepaymentCorridorBps,
  rateChangeMaxRepaymentBps: nullableOptionalRepaymentCorridorBps,
  rateChangeMinMonthlyCents: nonNegativeSafeInt.nullable().optional(),
  rateChangeMaxMonthlyCents: nonNegativeSafeInt.nullable().optional(),
  loanOptionsNote: nullableOptionalTrimmedString(500),
};

export const contractBaseObject = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  provider: nullableOptionalTrimmedString(120),
  category: contractCategorySchema,
  status: contractStatusSchema.default("active"),
  // Vorzeichen wird kategorieabhängig in refineBalanceSign geprüft.
  currentBalanceCents: signedSafeInt,
  balanceAsOfDate: isoDateSchema,
  monthlyRateCents: nonNegativeSafeInt.default(0),
  interestRateBps: basisPointsSchema.default(0),
  linkedPropertyId: nullableOptionalTrimmedString(120),
  milestoneDate: nullableOptionalIsoDate,
  milestoneLabel: nullableOptionalTrimmedString(120),
  repaymentType: repaymentTypeSchema.nullable().optional(),
  ...loanOptionSchemaFields,
  fixedInterestUntil: nullableOptionalIsoDate,
  targetSumCents: nonNegativeSafeInt.nullable().optional(),
  allocationThresholdPercent: z.number().int().min(0).max(100).nullable().optional(),
  futureLoanInterestRateBps: basisPointsSchema.nullable().optional(),
});

type ContractBaseValues = z.infer<typeof contractBaseObject>;

export interface NormalizedContractInput {
  name: string;
  provider: string | null;
  category: "loan" | "savings_contract";
  status: "active" | "paused" | "closed";
  currentBalanceCents: number;
  balanceAsOfDate: string;
  monthlyRateCents: number;
  interestRateBps: number;
  linkedPropertyId: string | null;
  milestoneDate: string | null;
  milestoneLabel: string | null;
  repaymentType: "annuity" | "installment" | "lump_sum" | null;
  originalPrincipalCents: number | null;
  specialRepaymentRight: OptionRight;
  specialRepaymentBasis: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents: number | null;
  specialRepaymentPercentBps: number | null;
  specialRepaymentUsedCents: number | null;
  specialRepaymentUsedYear: number | null;
  rateChangeRight: OptionRight;
  rateChangeTotalCount: number | null;
  rateChangeScope: RateChangeScope | null;
  rateChangeUsedCount: number;
  rateChangeMinRepaymentBps: number | null;
  rateChangeMaxRepaymentBps: number | null;
  rateChangeMinMonthlyCents: number | null;
  rateChangeMaxMonthlyCents: number | null;
  loanOptionsNote: string | null;
  fixedInterestUntil: string | null;
  targetSumCents: number | null;
  allocationThresholdPercent: number | null;
  futureLoanInterestRateBps: number | null;
}

export function normalizeContractPayload(
  input: ContractBaseValues,
): NormalizedContractInput {
  const base = {
    name: input.name,
    provider: input.provider ?? null,
    category: input.category,
    status: input.status,
    currentBalanceCents: input.currentBalanceCents,
    balanceAsOfDate: input.balanceAsOfDate,
    monthlyRateCents: input.monthlyRateCents,
    interestRateBps: input.interestRateBps,
    linkedPropertyId: input.linkedPropertyId ?? null,
    milestoneDate: input.milestoneDate ?? null,
    milestoneLabel: input.milestoneLabel ?? null,
  };

  if (input.category === "loan") {
    const repaymentType = input.repaymentType ?? "annuity";

    // Backward-compatible derivation when specialRepaymentRight is omitted
    let specialRight: OptionRight;
    let specialBasis: SpecialRepaymentBasis | null;
    let specialMaxYearly: number | null;
    let specialPercentBps: number | null;

    if (input.specialRepaymentRight !== undefined) {
      specialRight = input.specialRepaymentRight;
      specialBasis = input.specialRepaymentBasis ?? null;
      specialMaxYearly = input.specialRepaymentMaxYearlyCents ?? null;
      specialPercentBps = input.specialRepaymentPercentBps ?? null;
    } else if (input.specialRepaymentMaxYearlyCents == null) {
      specialRight = "unknown";
      specialBasis = null;
      specialMaxYearly = null;
      specialPercentBps = null;
    } else if (input.specialRepaymentMaxYearlyCents === 0) {
      specialRight = "none";
      specialBasis = null;
      specialMaxYearly = null;
      specialPercentBps = null;
    } else {
      specialRight = "allowed";
      specialBasis = input.specialRepaymentBasis ?? "fixed_yearly";
      specialMaxYearly = input.specialRepaymentMaxYearlyCents;
      specialPercentBps = input.specialRepaymentPercentBps ?? null;
    }

    if (specialRight !== "allowed") {
      specialBasis = null;
      specialMaxYearly = null;
      specialPercentBps = null;
    } else if (specialBasis === "fixed_yearly") {
      specialPercentBps = null;
    } else if (
      specialBasis === "percent_original" ||
      specialBasis === "percent_balance"
    ) {
      specialMaxYearly = null;
    } else {
      specialMaxYearly = null;
      specialPercentBps = null;
    }

    const rateChangeRight: OptionRight =
      repaymentType === "lump_sum"
        ? "none"
        : (input.rateChangeRight ?? "unknown");
    const allowRateFields =
      rateChangeRight === "allowed" && repaymentType !== "lump_sum";

    return {
      ...base,
      repaymentType,
      originalPrincipalCents: input.originalPrincipalCents ?? null,
      specialRepaymentRight: specialRight,
      specialRepaymentBasis: specialBasis,
      specialRepaymentMaxYearlyCents: specialMaxYearly,
      specialRepaymentPercentBps: specialPercentBps,
      specialRepaymentUsedCents: input.specialRepaymentUsedCents ?? null,
      specialRepaymentUsedYear: input.specialRepaymentUsedYear ?? null,
      rateChangeRight,
      rateChangeTotalCount: allowRateFields
        ? (input.rateChangeTotalCount ?? null)
        : null,
      rateChangeScope: allowRateFields ? (input.rateChangeScope ?? null) : null,
      rateChangeUsedCount: input.rateChangeUsedCount ?? 0,
      rateChangeMinRepaymentBps: allowRateFields
        ? (input.rateChangeMinRepaymentBps ?? null)
        : null,
      rateChangeMaxRepaymentBps: allowRateFields
        ? (input.rateChangeMaxRepaymentBps ?? null)
        : null,
      rateChangeMinMonthlyCents: allowRateFields
        ? (input.rateChangeMinMonthlyCents ?? null)
        : null,
      rateChangeMaxMonthlyCents: allowRateFields
        ? (input.rateChangeMaxMonthlyCents ?? null)
        : null,
      loanOptionsNote: input.loanOptionsNote ?? null,
      fixedInterestUntil: input.fixedInterestUntil ?? null,
      targetSumCents: null,
      allocationThresholdPercent: null,
      futureLoanInterestRateBps: null,
    };
  }

  return {
    ...base,
    repaymentType: null,
    originalPrincipalCents: null,
    specialRepaymentRight: "unknown",
    specialRepaymentBasis: null,
    specialRepaymentMaxYearlyCents: null,
    specialRepaymentPercentBps: null,
    specialRepaymentUsedCents: null,
    specialRepaymentUsedYear: null,
    rateChangeRight: "unknown",
    rateChangeTotalCount: null,
    rateChangeScope: null,
    rateChangeUsedCount: 0,
    rateChangeMinRepaymentBps: null,
    rateChangeMaxRepaymentBps: null,
    rateChangeMinMonthlyCents: null,
    rateChangeMaxMonthlyCents: null,
    loanOptionsNote: null,
    fixedInterestUntil: null,
    targetSumCents: input.targetSumCents ?? null,
    allocationThresholdPercent: input.allocationThresholdPercent ?? null,
    futureLoanInterestRateBps: input.futureLoanInterestRateBps ?? null,
  };
}

export function refineLoanOptionConsistency(
  data: ContractBaseValues,
  ctx: z.RefinementCtx,
): void {
  if (data.category !== "loan") {
    return;
  }

  const normalized = normalizeContractPayload(data);

  // Used cents/year must be paired
  const hasUsedCents = normalized.specialRepaymentUsedCents !== null;
  const hasUsedYear = normalized.specialRepaymentUsedYear !== null;
  if (hasUsedCents !== hasUsedYear) {
    ctx.addIssue({
      code: "custom",
      path: [
        hasUsedCents
          ? "specialRepaymentUsedYear"
          : "specialRepaymentUsedCents",
      ],
      message:
        "Genutzte Sondertilgung und zugehöriges Jahr müssen gemeinsam angegeben werden.",
    });
  }

  // Special repayment basis requires corresponding value
  if (normalized.specialRepaymentRight === "allowed") {
    if (
      normalized.specialRepaymentBasis === "fixed_yearly" &&
      (normalized.specialRepaymentMaxYearlyCents === null ||
        normalized.specialRepaymentMaxYearlyCents <= 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["specialRepaymentMaxYearlyCents"],
        message:
          "Bei festem Jahresbetrag muss ein Betrag größer als 0 € angegeben werden.",
      });
    }
    if (
      (normalized.specialRepaymentBasis === "percent_original" ||
        normalized.specialRepaymentBasis === "percent_balance") &&
      normalized.specialRepaymentPercentBps === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["specialRepaymentPercentBps"],
        message: "Bitte einen Prozentsatz größer als 0 % angeben.",
      });
    }
  }

  // Rate change consistency
  if (
    normalized.rateChangeRight === "allowed" &&
    normalized.repaymentType !== "lump_sum"
  ) {
    if (
      normalized.rateChangeTotalCount !== null &&
      normalized.rateChangeScope !== "per_year" &&
      normalized.rateChangeUsedCount > normalized.rateChangeTotalCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["rateChangeUsedCount"],
        message: `Bereits genutzte Wechsel (${normalized.rateChangeUsedCount}) dürfen die erlaubte Anzahl (${normalized.rateChangeTotalCount}) nicht überschreiten.`,
      });
    }

    if (
      normalized.rateChangeMinRepaymentBps !== null &&
      normalized.rateChangeMaxRepaymentBps !== null &&
      normalized.rateChangeMinRepaymentBps >
        normalized.rateChangeMaxRepaymentBps
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["rateChangeMaxRepaymentBps"],
        message:
          "Maximaler Tilgungssatz darf nicht kleiner als der minimale sein.",
      });
    }

    if (
      normalized.rateChangeMinMonthlyCents !== null &&
      normalized.rateChangeMaxMonthlyCents !== null &&
      normalized.rateChangeMinMonthlyCents >
        normalized.rateChangeMaxMonthlyCents
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["rateChangeMaxMonthlyCents"],
        message:
          "Maximale Monatsrate darf nicht kleiner als die minimale sein.",
      });
    }

    // Check corridor intersection via domain function (single source of math)
    if (
      (normalized.rateChangeMinRepaymentBps === null ||
        normalized.rateChangeMaxRepaymentBps === null ||
        normalized.rateChangeMinRepaymentBps <=
          normalized.rateChangeMaxRepaymentBps) &&
      (normalized.rateChangeMinMonthlyCents === null ||
        normalized.rateChangeMaxMonthlyCents === null ||
        normalized.rateChangeMinMonthlyCents <=
          normalized.rateChangeMaxMonthlyCents)
    ) {
      const corridor = resolveRateCorridor(
        {
          id: "validation-check",
          name: normalized.name,
          category: "loan",
          status: normalized.status,
          currentBalanceCents: normalized.currentBalanceCents,
          balanceAsOfDate: normalized.balanceAsOfDate,
          monthlyRateCents: normalized.monthlyRateCents,
          interestRateBps: normalized.interestRateBps,
          repaymentType: normalized.repaymentType,
          originalPrincipalCents: normalized.originalPrincipalCents,
          specialRepaymentRight: normalized.specialRepaymentRight,
          specialRepaymentBasis: normalized.specialRepaymentBasis,
          specialRepaymentMaxYearlyCents:
            normalized.specialRepaymentMaxYearlyCents,
          specialRepaymentPercentBps: normalized.specialRepaymentPercentBps,
          specialRepaymentUsedCents: normalized.specialRepaymentUsedCents,
          specialRepaymentUsedYear: normalized.specialRepaymentUsedYear,
          rateChangeRight: normalized.rateChangeRight,
          rateChangeTotalCount: normalized.rateChangeTotalCount,
          rateChangeScope: normalized.rateChangeScope,
          rateChangeUsedCount: normalized.rateChangeUsedCount,
          rateChangeMinRepaymentBps: normalized.rateChangeMinRepaymentBps,
          rateChangeMaxRepaymentBps: normalized.rateChangeMaxRepaymentBps,
          rateChangeMinMonthlyCents: normalized.rateChangeMinMonthlyCents,
          rateChangeMaxMonthlyCents: normalized.rateChangeMaxMonthlyCents,
          fixedInterestUntil: normalized.fixedInterestUntil,
        },
        normalized.balanceAsOfDate,
      );
      if (corridor.flags.corridorEmpty) {
        ctx.addIssue({
          code: "custom",
          path: ["rateChangeCorridor"],
          message:
            "Tilgungssatz- und Raten-Korridor haben keine gemeinsame Schnittmenge.",
        });
      }
    }
  }
}

/**
 * Darlehen: Restschuld >= 0. Bausparverträge dürfen negativ starten, weil die
 * Abschlussgebühr zuerst vom Guthaben abgebucht wird.
 */
export function refineBalanceSign(
  data: Pick<ContractBaseValues, "category" | "currentBalanceCents">,
  ctx: z.RefinementCtx,
): void {
  if (data.category === "loan" && data.currentBalanceCents < 0) {
    ctx.addIssue({
      code: "custom",
      path: ["currentBalanceCents"],
      message: "Die Restschuld eines Darlehens darf nicht negativ sein.",
    });
  }
}

export const contractCreateSchema = contractBaseObject
  .superRefine(refineBalanceSign)
  .superRefine(refineLoanOptionConsistency)
  .transform(normalizeContractPayload);

export const contractUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    provider: nullableOptionalTrimmedString(120),
    category: contractCategorySchema,
    status: contractStatusSchema,
    // Vorzeichen prüft contractCreateSchema am zusammengeführten Datensatz.
    currentBalanceCents: signedSafeInt,
    balanceAsOfDate: isoDateSchema,
    monthlyRateCents: nonNegativeSafeInt,
    interestRateBps: basisPointsSchema,
    linkedPropertyId: nullableOptionalTrimmedString(120),
    milestoneDate: nullableOptionalIsoDate,
    milestoneLabel: nullableOptionalTrimmedString(120),
    repaymentType: repaymentTypeSchema.nullable().optional(),
    ...loanOptionSchemaFields,
    fixedInterestUntil: nullableOptionalIsoDate,
    targetSumCents: nonNegativeSafeInt.nullable().optional(),
    allocationThresholdPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    futureLoanInterestRateBps: basisPointsSchema.nullable().optional(),
  })
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  );

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
