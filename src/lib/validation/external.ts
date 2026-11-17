import { z } from "zod";

export const finanzCockpitSummarySchema = z.object({
  source: z.literal("finanz_cockpit"),
  liquidCashCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  etfStocksCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  cryptoCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  totalPersonalNetWorthCents: z
    .number()
    .int()
    .min(Number.MIN_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  fetchedAt: z.iso.datetime(),
});

export type FinanzCockpitSummary = z.infer<typeof finanzCockpitSummarySchema>;

export const externalSyncRequestSchema = z.object({
  mode: z.enum(["manual", "auto"]).default("manual"),
});

export type ExternalSyncRequest = z.infer<typeof externalSyncRequestSchema>;
