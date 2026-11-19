import {
  MAX_ETF_RETURN_BPS,
  MAX_SAVER_ALLOWANCE_CENTS,
  MIN_ETF_RETURN_BPS,
} from "@/lib/domain/scenarios";
import { z } from "zod";

export const recommendationAssumptionsPatchSchema = z
  .object({
    emergencyFundMonths: z.number().int().min(1).max(12).optional(),
    etfAnnualReturnBps: z
      .number()
      .int()
      .min(MIN_ETF_RETURN_BPS)
      .max(MAX_ETF_RETURN_BPS)
      .optional(),
    safetyMarginBps: z.number().int().min(0).max(500).optional(),
    saverAllowanceCents: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAVER_ALLOWANCE_CENTS)
      .optional(),
    churchTaxBps: z
      .union([z.literal(0), z.literal(800), z.literal(900)])
      .optional(),
    shortHorizonMonths: z.number().int().min(1).max(120).optional(),
    savingsBufferBps: z.number().int().min(0).max(5000).optional(),
    emergencyFillMonths: z.number().int().min(1).max(60).optional(),
    specialRepaymentUsedThisYearCentsByLoanId: z
      .record(z.string().min(1), z.number().int().min(0))
      .optional(),
  })
  .strict();

export const explainRequestSchema = z
  .object({
    mode: z.enum(["one_time", "monthly"]),
    amountCents: z.number().int().min(0).max(1_000_000_000).optional(),
    assumptions: recommendationAssumptionsPatchSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.mode === "one_time" && val.amountCents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountCents"],
        message: "amountCents ist im Modus one_time erforderlich.",
      });
    }
  });

export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const recommendationExplanationSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    items: z
      .array(
        z
          .object({
            ref: z.string().regex(/^P[1-9]\d*$/),
            text: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    caveats: z.array(z.string().trim().min(1).max(300)).max(3),
  })
  .strict();

export type RecommendationExplanation = z.infer<
  typeof recommendationExplanationSchema
>;
