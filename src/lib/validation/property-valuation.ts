import { z } from "zod";
import { isoDateSchema } from "./contracts";

export const valuationFactorSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    effect: z.enum(["up", "down", "neutral"]),
  })
  .strict();

export const valuationModelOutputSchema = z
  .object({
    lowerEur: z.number().int(),
    medianEur: z.number().int(),
    upperEur: z.number().int(),
    asOfDate: isoDateSchema,
    rationale: z.string().trim().min(1).max(800),
    factors: z.array(valuationFactorSchema).max(6),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

export type ValuationModelOutput = z.infer<typeof valuationModelOutputSchema>;

export const groundingSourceSchema = z
  .object({
    uri: z
      .string()
      .trim()
      .refine((value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      }, "Nur https-URIs sind erlaubt."),
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const valuationPostBodySchema = z.object({}).strict();
