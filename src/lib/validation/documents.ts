import { z } from "zod";
import { nullableOptionalIsoDate } from "@/lib/validation/contracts";

const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

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

export const documentStatusSchema = z.enum(["pending_review", "verified"]);

export const documentTypeSchema = z.enum([
  "invoice",
  "bauspar_statement",
  "loan_statement",
  "contract",
  "tax_notice",
  "other",
]);

export const taxCategorySchema = z.enum([
  "handwerker_35a",
  "haushaltsnahe_dl_35a",
  "werbungskosten_vv",
  "capital_gains",
  "other",
]);

export const aiDocumentExtractionSchema = z
  .object({
    documentType: documentTypeSchema.default("other"),
    documentDate: nullableOptionalIsoDate.default(null),
    issuer: nullableOptionalTrimmedString(160).default(null),
    totalAmountCents: nonNegativeSafeInt.nullable().optional().default(null),
    isTaxRelevant: z.boolean().default(false),
    taxYear: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .nullable()
      .optional()
      .default(null),
    taxCategory: taxCategorySchema.nullable().optional().default(null),
    deductibleAmountCents: nonNegativeSafeInt
      .nullable()
      .optional()
      .default(null),
    detectedBalanceCents: nonNegativeSafeInt
      .nullable()
      .optional()
      .default(null),
  })
  .superRefine((data, ctx) => {
    if (
      data.totalAmountCents != null &&
      data.deductibleAmountCents != null &&
      data.deductibleAmountCents > data.totalAmountCents
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["deductibleAmountCents"],
        message:
          "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
      });
    }
  });

export type AiDocumentExtraction = z.infer<typeof aiDocumentExtractionSchema>;

const documentMetadataBaseObject = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  documentType: documentTypeSchema,
  documentDate: nullableOptionalIsoDate,
  issuer: nullableOptionalTrimmedString(160),
  totalAmountCents: nonNegativeSafeInt.nullable().optional(),
  linkedPropertyId: nullableOptionalTrimmedString(120),
  linkedContractId: nullableOptionalTrimmedString(120),
  isTaxRelevant: z.boolean(),
  taxYear: z.number().int().min(1900).max(2100).nullable().optional(),
  taxCategory: taxCategorySchema.nullable().optional(),
  deductibleAmountCents: nonNegativeSafeInt.nullable().optional(),
  detectedBalanceCents: nonNegativeSafeInt.nullable().optional(),
});

function validateDeductibleAgainstTotal(
  totalAmountCents: number | null | undefined,
  deductibleAmountCents: number | null | undefined,
  ctx: z.RefinementCtx,
): void {
  if (
    totalAmountCents != null &&
    deductibleAmountCents != null &&
    deductibleAmountCents > totalAmountCents
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["deductibleAmountCents"],
      message:
        "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
    });
  }
}

export interface NormalizedDocumentMetadata {
  filename?: string;
  documentType: z.infer<typeof documentTypeSchema>;
  documentDate: string | null;
  issuer: string | null;
  totalAmountCents: number | null;
  linkedPropertyId: string | null;
  linkedContractId: string | null;
  isTaxRelevant: boolean;
  taxYear: number | null;
  taxCategory: z.infer<typeof taxCategorySchema> | null;
  deductibleAmountCents: number | null;
  detectedBalanceCents: number | null;
}

function normalizeDocumentMetadata(
  data: z.infer<typeof documentMetadataBaseObject>,
): NormalizedDocumentMetadata {
  const documentDate = data.documentDate ?? null;
  const isTaxRelevant = data.isTaxRelevant;

  let taxYear = data.taxYear ?? null;
  if (isTaxRelevant && taxYear === null && documentDate !== null) {
    taxYear = Number(documentDate.slice(0, 4));
  }

  return {
    ...(data.filename !== undefined ? { filename: data.filename } : {}),
    documentType: data.documentType,
    documentDate,
    issuer: data.issuer ?? null,
    totalAmountCents: data.totalAmountCents ?? null,
    linkedPropertyId: data.linkedPropertyId ?? null,
    linkedContractId: data.linkedContractId ?? null,
    isTaxRelevant,
    taxYear,
    taxCategory: isTaxRelevant ? (data.taxCategory ?? null) : null,
    deductibleAmountCents: isTaxRelevant
      ? (data.deductibleAmountCents ?? null)
      : null,
    detectedBalanceCents: data.detectedBalanceCents ?? null,
  };
}

export const documentMetadataSchema = documentMetadataBaseObject
  .superRefine((data, ctx) => {
    validateDeductibleAgainstTotal(
      data.totalAmountCents,
      data.deductibleAmountCents,
      ctx,
    );
  })
  .transform(normalizeDocumentMetadata);

export const documentUpdateSchema = documentMetadataBaseObject
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  )
  .superRefine((data, ctx) => {
    validateDeductibleAgainstTotal(
      data.totalAmountCents,
      data.deductibleAmountCents,
      ctx,
    );
  });

export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>;

export const documentVerifySchema = documentMetadataBaseObject
  .extend({
    calibrateContract: z.boolean().default(false),
    calibratedBalanceCents: nonNegativeSafeInt.nullable().optional(),
    calibrationDate: nullableOptionalIsoDate,
    allowOlderCalibrationDate: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    validateDeductibleAgainstTotal(
      data.totalAmountCents,
      data.deductibleAmountCents,
      ctx,
    );

    if (data.calibrateContract) {
      if (!data.linkedContractId) {
        ctx.addIssue({
          code: "custom",
          path: ["linkedContractId"],
          message:
            "Für eine Vertrags-Eichung muss ein Vertrag verknüpft sein.",
        });
      }
      const targetBalance =
        data.calibratedBalanceCents ?? data.detectedBalanceCents ?? null;
      if (targetBalance === null) {
        ctx.addIssue({
          code: "custom",
          path: ["calibratedBalanceCents"],
          message:
            "Für eine Vertrags-Eichung muss ein neuer Vertragsstand angegeben sein.",
        });
      }
    }
  })
  .transform((data) => ({
    ...normalizeDocumentMetadata(data),
    calibrateContract: data.calibrateContract,
    calibratedBalanceCents: data.calibratedBalanceCents ?? null,
    calibrationDate: data.calibrationDate ?? null,
    allowOlderCalibrationDate: data.allowOlderCalibrationDate,
  }));

export type DocumentVerifyInput = z.infer<typeof documentVerifySchema>;
