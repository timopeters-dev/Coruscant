import { z } from "zod";

const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const positiveSafeInt = z
  .number()
  .int()
  .positive("Zu verteilender Betrag muss größer als 0 € sein.")
  .max(Number.MAX_SAFE_INTEGER);

function emptyStringToNull(value: unknown): unknown {
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }
  return value;
}

function nullableOptionalTrimmedId(maxLength = 120) {
  return z.preprocess(
    emptyStringToNull,
    z.string().trim().min(1).max(maxLength).nullable().optional(),
  );
}

export const cashflowDirectionSchema = z.enum(["inflow", "outflow"]);
export const cashflowFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "yearly",
]);

export const cashflowCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    direction: cashflowDirectionSchema,
    amountCents: nonNegativeSafeInt,
    frequency: cashflowFrequencySchema,
    active: z.boolean().default(true),
  })
  .strict();

export const cashflowUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    direction: cashflowDirectionSchema,
    amountCents: nonNegativeSafeInt,
    frequency: cashflowFrequencySchema,
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  );

export type CashflowCreateInput = z.infer<typeof cashflowCreateSchema>;
export type CashflowUpdateInput = z.infer<typeof cashflowUpdateSchema>;

export const potRuleTypeSchema = z.enum([
  "fill_to_target",
  "fixed_monthly",
  "percentage_of_remainder",
]);

export const externalLinkSchema = z
  .object({
    kind: z.enum(["account", "position"]),
    ref: z.string().trim().min(1, "Verknüpfungsziel ist erforderlich.").max(200),
  })
  .strict();

export type ExternalLinkInput = z.infer<typeof externalLinkSchema>;

const potBaseObject = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  currentCents: nonNegativeSafeInt.default(0),
  targetCents: nonNegativeSafeInt.nullable().optional(),
  ruleType: potRuleTypeSchema,
  fixedMonthlyCents: nonNegativeSafeInt.nullable().optional(),
  remainderPercentage: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .optional(),
  linkedContractId: nullableOptionalTrimmedId(120),
  linkedPropertyId: nullableOptionalTrimmedId(120),
  externalLink: externalLinkSchema.nullable().optional(),
});

type PotBaseValues = z.infer<typeof potBaseObject>;

export interface NormalizedPotInput {
  name: string;
  currentCents: number;
  targetCents: number | null;
  ruleType: "fill_to_target" | "fixed_monthly" | "percentage_of_remainder";
  fixedMonthlyCents: number | null;
  remainderPercentage: number | null;
  linkedContractId: string | null;
  linkedPropertyId: string | null;
  externalLink: ExternalLinkInput | null;
}

export function normalizePotPayload(input: PotBaseValues): NormalizedPotInput {
  const base = {
    name: input.name,
    currentCents: input.currentCents,
    linkedContractId: input.linkedContractId ?? null,
    linkedPropertyId: input.linkedPropertyId ?? null,
    externalLink: input.externalLink ?? null,
  };

  if (input.ruleType === "fill_to_target") {
    return {
      ...base,
      ruleType: "fill_to_target",
      targetCents: input.targetCents ?? null,
      fixedMonthlyCents: null,
      remainderPercentage: null,
    };
  }

  if (input.ruleType === "fixed_monthly") {
    return {
      ...base,
      ruleType: "fixed_monthly",
      targetCents: input.targetCents ?? null,
      fixedMonthlyCents: input.fixedMonthlyCents ?? null,
      remainderPercentage: null,
    };
  }

  return {
    ...base,
    ruleType: "percentage_of_remainder",
    targetCents: input.targetCents ?? null,
    fixedMonthlyCents: null,
    remainderPercentage: input.remainderPercentage ?? null,
  };
}

export const potCreateSchema = potBaseObject
  .superRefine((data, ctx) => {
    if (
      data.ruleType === "fill_to_target" &&
      (data.targetCents === null || data.targetCents === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetCents"],
        message: "Für die Regel „Bis Zielwert“ ist ein Zielbetrag erforderlich.",
      });
    }
    if (
      data.ruleType === "fixed_monthly" &&
      (data.fixedMonthlyCents === null || data.fixedMonthlyCents === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedMonthlyCents"],
        message:
          "Für die Regel „Fester Monatsbetrag“ ist ein Monatsbetrag erforderlich.",
      });
    }
    if (
      data.ruleType === "percentage_of_remainder" &&
      (data.remainderPercentage === null ||
        data.remainderPercentage === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["remainderPercentage"],
        message:
          "Für die Regel „% vom Rest“ ist ein Prozentwert (0–100) erforderlich.",
      });
    }
  })
  .transform(normalizePotPayload);

export const potUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    currentCents: nonNegativeSafeInt,
    targetCents: nonNegativeSafeInt.nullable().optional(),
    ruleType: potRuleTypeSchema,
    fixedMonthlyCents: nonNegativeSafeInt.nullable().optional(),
    remainderPercentage: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    linkedContractId: nullableOptionalTrimmedId(120),
    linkedPropertyId: nullableOptionalTrimmedId(120),
    externalLink: externalLinkSchema.nullable().optional(),
  })
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "Mindestens ein Feld muss aktualisiert werden." },
  );

export type PotCreateInput = z.infer<typeof potCreateSchema>;
export type PotUpdateInput = z.infer<typeof potUpdateSchema>;

export const potReorderSchema = z
  .object({
    orderedPotIds: z
      .array(z.string().trim().min(1, "Topf-ID darf nicht leer sein."))
      .min(1, "Mindestens eine Topf-ID erforderlich."),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const id of data.orderedPotIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["orderedPotIds"],
          message: "Doppelte Topf-IDs in der Sortierung sind unzulässig.",
        });
        return;
      }
      seen.add(id);
    }
  });

export type PotReorderInput = z.infer<typeof potReorderSchema>;

export const potAllocationEntrySchema = z.object({
  potId: z.string().trim().min(1, "Topf-ID ist erforderlich."),
  amountCents: nonNegativeSafeInt,
});

export const potAllocateSchema = z
  .object({
    inputAmountCents: positiveSafeInt,
    mode: z.enum(["monthly", "one_time"]),
    sourceLabel: z.string().trim().min(1, "Quelle ist erforderlich.").max(120),
    allocations: z
      .array(potAllocationEntrySchema)
      .min(1, "Mindestens eine Topf-Zuteilung erforderlich."),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    let total = 0n;

    for (const entry of data.allocations) {
      if (seen.has(entry.potId)) {
        ctx.addIssue({
          code: "custom",
          path: ["allocations"],
          message: "Jeder Topf darf nur einmal in der Verteilung vorkommen.",
        });
        return;
      }
      seen.add(entry.potId);
      total += BigInt(entry.amountCents);
    }

    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Die Summe der Zuteilungen überschreitet den zulässigen Wertebereich.",
      });
      return;
    }

    if (total <= 0n) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Mindestens ein Topf muss einen Betrag > 0 € erhalten.",
      });
    }

    if (total > BigInt(data.inputAmountCents)) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message:
          "Die Summe der Zuteilungen darf den verfügbaren Betrag nicht überschreiten.",
      });
    }
  });

export type PotAllocateInput = z.infer<typeof potAllocateSchema>;
