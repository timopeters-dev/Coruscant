import { z } from "zod";
import { parseIsoDate } from "@/lib/domain/date";

const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const basisPointsSchema = z.number().int().nonnegative().max(100_000);

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

function nullableOptionalTrimmedString(maxLength = 120) {
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

export const propertyCreateSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  usage: propertyUsageSchema.default("owner_occupied"),
  purchaseDate: nullableOptionalIsoDate,
  purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
  estimatedValueCents: nonNegativeSafeInt,
});

export const propertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    usage: propertyUsageSchema,
    purchaseDate: nullableOptionalIsoDate,
    purchasePriceCents: nonNegativeSafeInt.nullable().optional(),
    estimatedValueCents: nonNegativeSafeInt,
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

const contractBaseObject = z.object({
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
