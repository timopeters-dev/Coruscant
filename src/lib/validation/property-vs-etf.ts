import { z } from "zod";
import type { PropertyVsEtfInput } from "../domain/property-vs-etf";
import {
  calculatePurchaseCostsCents,
  PROPERTY_VS_ETF_LIMITS,
} from "../domain/property-vs-etf-defaults";

const limits = PROPERTY_VS_ETF_LIMITS;

const inRange = (v: unknown, r: { min: number; max: number }): boolean =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= r.min && v <= r.max;

function intField(
  label: string,
  range: { min: number; max: number },
  messages: { invalid: string; unit: string; min: string; max: string },
) {
  return z
    .number({ message: `${label}: ${messages.invalid}` })
    .int(`${label}: ${messages.unit}`)
    .min(range.min, `${label}: ${messages.min}`)
    .max(range.max, `${label}: ${messages.max}`);
}

const money = (label: string, range: { min: number; max: number }, minText: string, maxText: string) =>
  intField(label, range, {
    invalid: "gültigen Betrag angeben",
    unit: "ganze Cent erforderlich",
    min: minText,
    max: maxText,
  });

const percent = (label: string, range: { min: number; max: number }, minText: string, maxText: string) =>
  intField(label, range, {
    invalid: "gültigen Wert angeben",
    unit: "ganze Basispunkte erforderlich",
    min: minText,
    max: maxText,
  });

export const propertyVsEtfInputSchema = z
  .object({
    purchasePriceCents: money(
      "Kaufpreis",
      limits.purchasePriceCents,
      "mindestens 0,01 €",
      "höchstens 100.000.000,00 €",
    ),
    livingAreaCentiSqm: intField("Wohnfläche", limits.livingAreaCentiSqm, {
      invalid: "gültigen Wert angeben",
      unit: "ganze Hundertstel-qm erforderlich",
      min: "mindestens 0,01 qm",
      max: "höchstens 1.000,00 qm",
    }),
    coldRentPerSqmCents: money(
      "Kaltmiete pro qm",
      limits.coldRentPerSqmCents,
      "mindestens 0,00 €",
      "höchstens 100,00 €/qm",
    ),
    purchaseCostsBps: percent(
      "Kaufnebenkosten",
      limits.purchaseCostsBps,
      "mindestens 0,00 %",
      "höchstens 30,00 %",
    ),
    equityCents: money(
      "Eigenkapital",
      limits.equityCents,
      "mindestens 0,00 €",
      "höchstens 200.000.000,00 €",
    ),
    interestRateBps: percent(
      "Zinssatz",
      limits.interestRateBps,
      "mindestens 0,00 %",
      "höchstens 15,00 %",
    ),
    initialRepaymentBps: percent(
      "Anfangstilgung",
      limits.initialRepaymentBps,
      "mindestens 0,00 %",
      "höchstens 10,00 %",
    ),
    rentGrowthBps: percent(
      "Mietsteigerung",
      limits.rentGrowthBps,
      "mindestens −10,00 %",
      "höchstens 10,00 %",
    ),
    valueGrowthBps: percent(
      "Wertsteigerung",
      limits.valueGrowthBps,
      "mindestens −10,00 %",
      "höchstens 10,00 %",
    ),
    costGrowthBps: percent(
      "Kostensteigerung",
      limits.costGrowthBps,
      "mindestens −10,00 %",
      "höchstens 10,00 %",
    ),
    vacancyBps: percent(
      "Mietausfall",
      limits.vacancyBps,
      "mindestens 0,00 %",
      "höchstens 50,00 %",
    ),
    monthlyHoaCostsCents: money(
      "WEG-Kosten",
      limits.monthlyHoaCostsCents,
      "mindestens 0,00 €",
      "höchstens 100.000,00 €/Monat",
    ),
    maintenanceReserveBps: percent(
      "Instandhaltungsrücklage",
      limits.maintenanceReserveBps,
      "mindestens 0,00 %",
      "höchstens 5,00 %",
    ),
    etfAnnualReturnBps: percent(
      "ETF-Rendite",
      limits.etfAnnualReturnBps,
      "mindestens −50,00 %",
      "höchstens 30,00 %",
    ),
    horizonYears: intField("Horizont", limits.horizonYears, {
      invalid: "gültige Jahreszahl angeben",
      unit: "ganze Jahre zwischen 1 und 40",
      min: "ganze Jahre zwischen 1 und 40",
      max: "ganze Jahre zwischen 1 und 40",
    }),
  })
  .superRefine((value, ctx) => {
    // Zod 4 führt Objekt-Refinements auch bei Feldfehlern aus: nur vergleichen,
    // wenn alle beteiligten Felder gültig sind (sonst Folgefehler auf equityCents).
    if (
      !inRange(value.purchasePriceCents, limits.purchasePriceCents) ||
      !inRange(value.purchaseCostsBps, limits.purchaseCostsBps) ||
      !inRange(value.equityCents, limits.equityCents)
    ) {
      return;
    }
    const purchaseCosts = calculatePurchaseCostsCents(
      value.purchasePriceCents,
      value.purchaseCostsBps,
    );
    if (value.equityCents < purchaseCosts) {
      ctx.addIssue({
        code: "custom",
        message: "Eigenkapital muss mindestens die Kaufnebenkosten decken",
        path: ["equityCents"],
      });
    } else if (value.equityCents > value.purchasePriceCents + purchaseCosts) {
      ctx.addIssue({
        code: "custom",
        message:
          "Eigenkapital darf Kaufpreis plus Nebenkosten nicht übersteigen",
        path: ["equityCents"],
      });
    }
  });

export type PropertyVsEtfInputParsed = z.infer<typeof propertyVsEtfInputSchema>;

// Typgleichheit mit der Domänen-Eingabe (beide Richtungen).
const _parsedToDomain = (v: PropertyVsEtfInputParsed): PropertyVsEtfInput => v;
const _domainToParsed = (v: PropertyVsEtfInput): PropertyVsEtfInputParsed => v;
void _parsedToDomain;
void _domainToParsed;
