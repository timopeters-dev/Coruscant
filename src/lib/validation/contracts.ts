import { z } from "zod";
import { parseIsoDate } from "@/lib/domain/date";
import { PROPERTY_PURCHASE_LIMITS } from "@/lib/domain/property-purchase-defaults";
import { validateRentalProfile } from "@/lib/domain/rental";

export const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
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
    purchaseDate: nullableOptionalIsoDate,
    purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
    estimatedValueCents: nonNegativeSafeInt,
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
  });

export const propertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    usage: propertyUsageSchema,
    purchaseDate: nullableOptionalIsoDate,
    purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
    estimatedValueCents: nonNegativeSafeInt,
    maintenanceReservePotId: nullableOptionalTrimmedString(120),
    ...rentalProfileFields,
    ...propertyMetadataFields,
  })
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  );

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const contractSphereSchema = z.enum(["household", "personal"]);
export const contractCategorySchema = z.enum(["loan", "savings_contract"]);
export const contractStatusSchema = z.enum(["active", "paused", "closed"]);
export const repaymentTypeSchema = z.enum([
  "annuity",
  "installment",
  "lump_sum",
]);

export const contractBaseObject = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  provider: nullableOptionalTrimmedString(120),
  sphere: contractSphereSchema.default("household"),
  category: contractCategorySchema,
  status: contractStatusSchema.default("active"),
  currentBalanceCents: nonNegativeSafeInt,
  balanceAsOfDate: isoDateSchema,
  monthlyRateCents: nonNegativeSafeInt.default(0),
  interestRateBps: basisPointsSchema.default(0),
  linkedPropertyId: nullableOptionalTrimmedString(120),
  milestoneDate: nullableOptionalIsoDate,
  milestoneLabel: nullableOptionalTrimmedString(120),
  repaymentType: repaymentTypeSchema.nullable().optional(),
  specialRepaymentMaxYearlyCents: nonNegativeSafeInt.nullable().optional(),
  fixedInterestUntil: nullableOptionalIsoDate,
  targetSumCents: nonNegativeSafeInt.nullable().optional(),
  allocationThresholdPercent: z.number().int().min(0).max(100).nullable().optional(),
  futureLoanInterestRateBps: basisPointsSchema.nullable().optional(),
});

type ContractBaseValues = z.infer<typeof contractBaseObject>;

export interface NormalizedContractInput {
  name: string;
  provider: string | null;
  sphere: "household" | "personal";
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
  specialRepaymentMaxYearlyCents: number | null;
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
    sphere: input.sphere,
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
    return {
      ...base,
      repaymentType: input.repaymentType ?? "annuity",
      specialRepaymentMaxYearlyCents:
        input.specialRepaymentMaxYearlyCents ?? null,
      fixedInterestUntil: input.fixedInterestUntil ?? null,
      targetSumCents: null,
      allocationThresholdPercent: null,
      futureLoanInterestRateBps: null,
    };
  }

  return {
    ...base,
    repaymentType: null,
    specialRepaymentMaxYearlyCents: null,
    fixedInterestUntil: null,
    targetSumCents: input.targetSumCents ?? null,
    allocationThresholdPercent: input.allocationThresholdPercent ?? null,
    futureLoanInterestRateBps: input.futureLoanInterestRateBps ?? null,
  };
}

export const contractCreateSchema = contractBaseObject.transform(
  normalizeContractPayload,
);

export const contractUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    provider: nullableOptionalTrimmedString(120),
    sphere: contractSphereSchema,
    category: contractCategorySchema,
    status: contractStatusSchema,
    currentBalanceCents: nonNegativeSafeInt,
    balanceAsOfDate: isoDateSchema,
    monthlyRateCents: nonNegativeSafeInt,
    interestRateBps: basisPointsSchema,
    linkedPropertyId: nullableOptionalTrimmedString(120),
    milestoneDate: nullableOptionalIsoDate,
    milestoneLabel: nullableOptionalTrimmedString(120),
    repaymentType: repaymentTypeSchema.nullable().optional(),
    specialRepaymentMaxYearlyCents: nonNegativeSafeInt.nullable().optional(),
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
