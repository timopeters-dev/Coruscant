import { z } from "zod";
import {
  MAX_ADJUSTMENT_ITEM_BPS,
  MAX_ADJUSTMENT_LABEL_LENGTH,
  MAX_VALUATION_ADJUSTMENTS,
  normalizeAdjustmentLabel,
  validateValuationAdjustments,
} from "@/domain/properties/valuation/adjustments";
import { nonNegativeSafeInt } from "./contracts";

export const valuationAdjustmentItemSchema = z
  .object({
    label: z
      .string()
      .transform(normalizeAdjustmentLabel)
      .refine((val) => val.length >= 1, {
        message: "Bezeichnung darf nicht leer sein.",
      })
      .refine((val) => val.length <= MAX_ADJUSTMENT_LABEL_LENGTH, {
        message: `Bezeichnung darf höchstens ${MAX_ADJUSTMENT_LABEL_LENGTH} Zeichen lang sein.`,
      }),
    bps: z
      .number()
      .int("Prozentwert muss ganzzahlig in Basispunkten sein.")
      .refine((val) => val !== 0, {
        message: "Posten ohne Wirkung (0 %) bitte entfernen.",
      })
      .refine((val) => Math.abs(val) <= MAX_ADJUSTMENT_ITEM_BPS, {
        message: "Einzelner Posten darf höchstens ±50,00 % betragen.",
      }),
    catalogKey: z.string().min(1).max(64).optional(),
  })
  .strict();

export const valuationAdjustmentsPutBodySchema = z
  .object({
    adjustments: z
      .array(valuationAdjustmentItemSchema)
      .max(
        MAX_VALUATION_ADJUSTMENTS,
        `Maximal ${MAX_VALUATION_ADJUSTMENTS} Korrekturposten zulässig.`,
      ),
    expectedEstimatedValueCents: nonNegativeSafeInt.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const result = validateValuationAdjustments(data.adjustments);
    if (!result.ok) {
      for (const err of result.errors) {
        if (err.code === "label_duplicate" && err.index !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments", err.index, "label"],
            message: "Bezeichnung darf nicht doppelt vorkommen.",
          });
        } else if (err.code === "catalog_key_unknown" && err.index !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments", err.index, "catalogKey"],
            message: "Unbekannter Katalog-Posten.",
          });
        } else if (
          err.code === "catalog_key_duplicate" &&
          err.index !== undefined
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments", err.index, "catalogKey"],
            message: "Katalog-Posten doppelt gewählt.",
          });
        } else if (err.code === "exclusive_conflict" && err.index !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments", err.index],
            message: "Schließt sich mit einem anderen gewählten Posten aus.",
          });
        } else if (err.code === "total_out_of_range") {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments"],
            message: "Summe der Korrekturen darf höchstens ±50,00 % betragen.",
          });
        } else if (err.index !== undefined) {
          const field = err.code.startsWith("label_") ? "label" : "bps";
          ctx.addIssue({
            code: "custom",
            path: ["adjustments", err.index, field],
            message: "Ungültiger Korrekturposten.",
          });
        } else {
          ctx.addIssue({
            code: "custom",
            path: ["adjustments"],
            message: "Ungültige Korrekturposten.",
          });
        }
      }
    }
  });

export type ValuationAdjustmentsPutBody = z.infer<
  typeof valuationAdjustmentsPutBodySchema
>;
