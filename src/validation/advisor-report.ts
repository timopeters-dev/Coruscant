import { z } from "zod";

export const advisorQuestionCheckSchema = z
  .object({
    text: z.string().max(2000),
  })
  .strict();

export type AdvisorQuestionCheckInput = z.infer<
  typeof advisorQuestionCheckSchema
>;
