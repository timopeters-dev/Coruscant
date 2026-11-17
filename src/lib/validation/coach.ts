import { z } from "zod";

export const COACH_ASSET_CLASSES = ["etf", "stock", "crypto"] as const;
export const MAX_COACH_CHAT_MESSAGE_LENGTH = 1000;
export const MAX_COACH_REPLY_ANSWER_LENGTH = 2000;
export const MAX_COACH_REQUEST_MESSAGES = 40;
export const MAX_COACH_SAVINGS_RATE_CENTS = 10_000_000;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const coachRefSchema = z
  .string()
  .regex(/^(?:(?:ETF|AKTIE|KRYPTO|ZIEL|MEILENSTEIN)-\d{1,3}|NOTGROSCHEN)$/);

const bps = z.number().int().min(0).max(10_000);

export const coachAssessmentSchema = z
  .object({
    summary: text(1, 600),
    strengths: z
      .array(z.object({ title: text(1, 80), detail: text(1, 400) }).strict())
      .min(1)
      .max(5),
    risks: z
      .array(
        z
          .object({
            title: text(1, 80),
            detail: text(1, 400),
            severity: z.enum(["low", "medium", "high"]),
            relatedRefs: z.array(coachRefSchema).max(10),
          })
          .strict(),
      )
      .max(5),
    horizonCheck: z
      .array(
        z
          .object({
            ref: coachRefSchema,
            fit: z.enum(["fits", "tension", "mismatch"]),
            explanation: text(1, 400),
          })
          .strict(),
      )
      .max(12),
    rebalancing: z
      .object({
        targetWeightsBps: z.object({ etf: bps, stock: bps, crypto: bps }).strict(),
        rationale: text(1, 600),
        preferContributionsOnly: z.boolean(),
      })
      .strict()
      .nullable(),
    glossary: z
      .array(z.object({ term: text(1, 60), explanation: text(1, 300) }).strict())
      .max(5),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.rebalancing === null) return;
    const w = data.rebalancing.targetWeightsBps;
    if (w.etf + w.stock + w.crypto !== 10_000) {
      ctx.addIssue({
        code: "custom",
        path: ["rebalancing", "targetWeightsBps"],
        message: "Die Ziel-Gewichte müssen in Summe exakt 10.000 Bps ergeben.",
      });
    }
  });

export type CoachAssessment = z.infer<typeof coachAssessmentSchema>;

export const coachChatReplySchema = z
  .object({
    answer: text(1, MAX_COACH_REPLY_ANSWER_LENGTH),
    followUpQuestions: z.array(text(1, 160)).max(3),
    declinedSecurityAdvice: z.boolean(),
  })
  .strict();

export type CoachChatReply = z.infer<typeof coachChatReplySchema>;

const savingsRate = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_COACH_SAVINGS_RATE_CENTS);

export const coachAssessmentRequestSchema = z
  .object({ monthlySavingsRateCents: savingsRate.optional() })
  .strict();

// Nutzer bis 1.000 Zeichen; Coach-Antworten (answer ≤ 2.000) laufen im Verlauf zurück.
export const coachChatMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      text: text(1, MAX_COACH_CHAT_MESSAGE_LENGTH),
    })
    .strict(),
  z
    .object({
      role: z.literal("coach"),
      text: text(1, MAX_COACH_REPLY_ANSWER_LENGTH),
    })
    .strict(),
]);

export type CoachChatMessage = z.infer<typeof coachChatMessageSchema>;

export const coachChatRequestSchema = z
  .object({
    monthlySavingsRateCents: savingsRate.optional(),
    messages: z.array(coachChatMessageSchema).min(1).max(MAX_COACH_REQUEST_MESSAGES),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.messages[data.messages.length - 1]?.role !== "user") {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "Die letzte Nachricht muss vom Nutzer stammen.",
      });
    }
  });

export type CoachChatRequest = z.infer<typeof coachChatRequestSchema>;
