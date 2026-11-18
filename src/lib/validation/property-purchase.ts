import { z } from "zod";
import type { PropertyPurchaseInput } from "../domain/property-purchase";
import { PROPERTY_PURCHASE_LIMITS } from "../domain/property-purchase-defaults";

const limits = PROPERTY_PURCHASE_LIMITS;

const purchaseCostItemSchema = z.object({
  key: z.string().trim().min(1, "Nebenkosten-Key darf nicht leer sein"),
  label: z
    .string()
    .trim()
    .min(
      limits.costItems.minLabelLength,
      "Nebenkosten-Posten: Bezeichnung darf nicht leer sein",
    )
    .max(
      limits.costItems.maxLabelLength,
      `Nebenkosten-Posten: Bezeichnung höchstens ${limits.costItems.maxLabelLength} Zeichen`,
    ),
  bps: z
    .number({ message: "Nebenkosten-Posten: gültige Prozentzahl angeben" })
    .int("Nebenkosten-Posten: ganze Basispunkte erforderlich")
    .min(limits.costItems.minBps, "Nebenkosten-Posten: mindestens 0,00 %")
    .max(limits.costItems.maxBps, "Nebenkosten-Posten: höchstens 20,00 %"),
});

export const propertyPurchaseInputSchema = z.object({
  purchasePriceCents: z
    .number({ message: "Kaufpreis: gültigen Betrag angeben" })
    .int("Kaufpreis: ganze Cent erforderlich")
    .min(limits.purchasePriceCents.min, "Kaufpreis: mindestens 0,00 €")
    .max(
      limits.purchasePriceCents.max,
      "Kaufpreis: höchstens 100.000.000,00 €",
    ),
  costItems: z
    .array(purchaseCostItemSchema, {
      message: "Nebenkosten-Posten: gültige Liste erforderlich",
    })
    .min(
      limits.costItems.minCount,
      `Mindestens ${limits.costItems.minCount} Nebenkosten-Posten erforderlich`,
    )
    .max(
      limits.costItems.maxCount,
      `Höchstens ${limits.costItems.maxCount} Nebenkosten-Posten zulässig`,
    )
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Nebenkosten-Posten: doppelter Schlüssel",
            path: [index, "key"],
          });
        }
        seen.add(item.key);
      });
    }),
  equityCents: z
    .number({ message: "Eigenkapital: gültigen Betrag angeben" })
    .int("Eigenkapital: ganze Cent erforderlich")
    .min(limits.equityCents.min, "Eigenkapital: mindestens 0,00 €")
    .max(
      limits.equityCents.max,
      "Eigenkapital: höchstens 100.000.000,00 €",
    ),
  requireEquityCoversCosts: z.boolean({
    message: "Mindest-EK-Schalter: gültiger Wahrheitswert erforderlich",
  }),
  interestRateBps: z
    .number({ message: "Zinssatz: gültigen Wert angeben" })
    .int("Zinssatz: ganze Basispunkte erforderlich")
    .min(limits.interestRateBps.min, "Zinssatz: mindestens 0,00 %")
    .max(limits.interestRateBps.max, "Zinssatz: höchstens 15,00 %"),
  initialRepaymentBps: z
    .number({ message: "Anfangstilgung: gültigen Wert angeben" })
    .int("Anfangstilgung: ganze Basispunkte erforderlich")
    .min(limits.initialRepaymentBps.min, "Anfangstilgung: mindestens 0,00 %")
    .max(limits.initialRepaymentBps.max, "Anfangstilgung: höchstens 10,00 %"),
  fixedRateYears: z
    .number({ message: "Zinsbindung: gültige Jahreszahl angeben" })
    .int("Zinsbindung: ganze Jahre zwischen 1 und 40")
    .min(
      limits.fixedRateYears.min,
      "Zinsbindung: ganze Jahre zwischen 1 und 40",
    )
    .max(
      limits.fixedRateYears.max,
      "Zinsbindung: ganze Jahre zwischen 1 und 40",
    ),
  monthlyColdRentCents: z
    .number({ message: "Kaltmiete: gültigen Betrag angeben" })
    .int("Kaltmiete: ganze Cent erforderlich")
    .min(limits.monthlyColdRentCents.min, "Kaltmiete: mindestens 0,00 €")
    .max(
      limits.monthlyColdRentCents.max,
      "Kaltmiete: höchstens 100.000,00 €/Monat",
    ),
  monthlyNonRecoverableCostsCents: z
    .number({ message: "Nicht umlagefähige Kosten: gültigen Betrag angeben" })
    .int("Nicht umlagefähige Kosten: ganze Cent erforderlich")
    .min(
      limits.monthlyNonRecoverableCostsCents.min,
      "Nicht umlagefähige Kosten: mindestens 0,00 €",
    )
    .max(
      limits.monthlyNonRecoverableCostsCents.max,
      "Nicht umlagefähige Kosten: höchstens 100.000,00 €/Monat",
    ),
  monthlyMaintenanceCents: z
    .number({ message: "Instandhaltung: gültigen Betrag angeben" })
    .int("Instandhaltung: ganze Cent erforderlich")
    .min(limits.monthlyMaintenanceCents.min, "Instandhaltung: mindestens 0,00 €")
    .max(
      limits.monthlyMaintenanceCents.max,
      "Instandhaltung: höchstens 100.000,00 €/Monat",
    ),
});

export type PropertyPurchaseValidationResult =
  | { ok: true; input: PropertyPurchaseInput }
  | { ok: false; fieldErrors: Record<string, string> };

export function validatePropertyPurchaseForm(
  raw: unknown,
): PropertyPurchaseValidationResult {
  const parsed = propertyPurchaseInputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, input: parsed.data };
  }

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return { ok: false, fieldErrors };
}
