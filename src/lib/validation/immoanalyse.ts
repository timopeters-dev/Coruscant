import { z } from "zod";

export const immoAnalyseValuationResponseSchema = z
  .object({
    request_id: z.string().min(1),
    cached: z.boolean().optional().default(false),
    data_as_of: z.string().nullable().optional(),
    bewertbarkeit: z.object({
      status: z.enum([
        "valuable",
        "valuable_with_limitations",
        "not_reliably_valuable",
      ]),
      begruendung: z.string().nullable().optional(),
      limitations: z.array(z.unknown()).nullable().optional(),
    }),
    marktwert: z
      .object({
        min: z.number().finite().nonnegative(),
        median: z.number().finite().nonnegative(),
        max: z.number().finite().nonnegative(),
        preis_pro_m2: z.number().finite().nonnegative().nullable().optional(),
      })
      .nullable()
      .optional(),
    konfidenz: z
      .object({
        wert: z.number().int().min(0).max(100).nullable().optional(),
        level: z.enum(["hoch", "mittel", "niedrig"]),
      })
      .nullable()
      .optional(),
    kennzahlen: z
      .object({
        merkmal_anpassung: z
          .object({
            posten: z
              .array(
                z.object({
                  merkmal: z.string().optional(),
                  label: z.string(),
                  prozent: z.number().finite(),
                }),
              )
              .optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    kontingent: z
      .object({
        limit: z.number().int().nonnegative(),
        verbraucht: z.number().int().nonnegative(),
        verbleibend: z.number().int().nonnegative(),
        reset_at: z.string().nullable().optional(),
        tarif: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.bewertbarkeit.status !== "not_reliably_valuable" &&
      !data.marktwert
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["marktwert"],
        message: "marktwert ist erforderlich, wenn Objekt bewertbar ist.",
      });
    }
  });

export type ImmoAnalyseValuationResponse = z.infer<
  typeof immoAnalyseValuationResponseSchema
>;

export const immoAnalyseErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    status: z.union([z.string(), z.number()]).optional(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ImmoAnalyseErrorPayload = z.infer<typeof immoAnalyseErrorSchema>;

export function parseImmoAnalyseErrorPayload(
  raw: unknown,
): ImmoAnalyseErrorPayload | null {
  const parsed = immoAnalyseErrorSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const valuationAdoptBodySchema = z
  .object({
    historyId: z.string().uuid(),
    choice: z.enum(["lower", "median", "upper"]),
  })
  .strict();

export type ValuationAdoptBody = z.infer<typeof valuationAdoptBodySchema>;

export const valuationPostBodySchema = z.object({}).strict();
