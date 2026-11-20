import { parseEuroInputToCents } from "@/domain/core/money";
import {
  simulatePropertyVsEtf,
  type PropertyVsEtfInput,
  type PropertyVsEtfResult,
} from "@/domain/planning/property-vs-etf";
import {
  calculatePurchaseCostsCents,
  DEFAULT_REINVEST_SURPLUS,
  defaultEquityCents,
  PROPERTY_VS_ETF_DEFAULTS,
  PROPERTY_VS_ETF_SLIDER_RANGES,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
} from "@/domain/planning/property-vs-etf-defaults";
import type { PropertyVsEtfTaxInput } from "@/domain/planning/property-vs-etf-tax";
import {
  propertyVsEtfInputSchema,
  propertyVsEtfTaxInputSchema,
} from "@/validation/property-vs-etf";

/** Pflichtfelder des Objekts: anfangs leer (`null`), keine Vorbelegung. */
export type ObjectFieldKey =
  | "purchasePriceCents"
  | "livingAreaCentiSqm"
  | "coldRentPerSqmCents";

/** Annahmen-Felder (Block „Annahmen“). */
export type AssumptionFieldKey =
  | "interestRateBps"
  | "initialRepaymentBps"
  | "rentGrowthBps"
  | "valueGrowthBps"
  | "costGrowthBps"
  | "vacancyBps"
  | "monthlyHoaCostsCents"
  | "maintenanceReserveBps"
  | "etfAnnualReturnBps"
  | "horizonYears";

export type NumericFieldKey =
  | ObjectFieldKey
  | "purchaseCostsBps"
  | AssumptionFieldKey;

export type TaxNumericFieldKey = Exclude<
  keyof PropertyVsEtfTaxInput,
  "taxesEnabled"
>;

export interface PropertyVsEtfFormState {
  purchasePriceCents: number | null;
  livingAreaCentiSqm: number | null;
  coldRentPerSqmCents: number | null;
  purchaseCostsBps: number;
  equityMode: "auto" | "manual";
  manualEquityCents: number;
  interestRateBps: number;
  initialRepaymentBps: number;
  rentGrowthBps: number;
  valueGrowthBps: number;
  costGrowthBps: number;
  vacancyBps: number;
  monthlyHoaCostsCents: number;
  maintenanceReserveBps: number;
  etfAnnualReturnBps: number;
  horizonYears: number;
  reinvestSurplus: boolean;
  tax: PropertyVsEtfTaxInput;
}

const OBJECT_FIELDS: readonly ObjectFieldKey[] = [
  "purchasePriceCents",
  "livingAreaCentiSqm",
  "coldRentPerSqmCents",
];

const ASSUMPTION_FIELDS: readonly AssumptionFieldKey[] = [
  "interestRateBps",
  "initialRepaymentBps",
  "rentGrowthBps",
  "valueGrowthBps",
  "costGrowthBps",
  "vacancyBps",
  "monthlyHoaCostsCents",
  "maintenanceReserveBps",
  "etfAnnualReturnBps",
  "horizonYears",
];

function assumptionDefaults(): Pick<
  PropertyVsEtfFormState,
  AssumptionFieldKey
> {
  return {
    interestRateBps: PROPERTY_VS_ETF_DEFAULTS.interestRateBps,
    initialRepaymentBps: PROPERTY_VS_ETF_DEFAULTS.initialRepaymentBps,
    rentGrowthBps: PROPERTY_VS_ETF_DEFAULTS.rentGrowthBps,
    valueGrowthBps: PROPERTY_VS_ETF_DEFAULTS.valueGrowthBps,
    costGrowthBps: PROPERTY_VS_ETF_DEFAULTS.costGrowthBps,
    vacancyBps: PROPERTY_VS_ETF_DEFAULTS.vacancyBps,
    monthlyHoaCostsCents: PROPERTY_VS_ETF_DEFAULTS.monthlyHoaCostsCents,
    maintenanceReserveBps: PROPERTY_VS_ETF_DEFAULTS.maintenanceReserveBps,
    etfAnnualReturnBps: PROPERTY_VS_ETF_DEFAULTS.etfAnnualReturnBps,
    horizonYears: PROPERTY_VS_ETF_DEFAULTS.horizonYears,
  };
}

function taxDefaults(): PropertyVsEtfTaxInput {
  return { ...PROPERTY_VS_ETF_TAX_DEFAULTS };
}

export function createPropertyVsEtfFormState(): PropertyVsEtfFormState {
  return {
    purchasePriceCents: null,
    livingAreaCentiSqm: null,
    coldRentPerSqmCents: null,
    purchaseCostsBps: PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps,
    equityMode: "auto",
    manualEquityCents: 0,
    ...assumptionDefaults(),
    reinvestSurplus: DEFAULT_REINVEST_SURPLUS,
    tax: taxDefaults(),
  };
}

export type PropertyVsEtfAction =
  | { type: "setField"; field: NumericFieldKey; value: number | null }
  | { type: "setEquity"; value: number }
  | { type: "resetEquityToCosts" }
  | { type: "setTaxField"; field: TaxNumericFieldKey; value: number }
  | { type: "setTaxesEnabled"; value: boolean }
  | { type: "setReinvestSurplus"; value: boolean }
  | { type: "resetAssumptions" }
  | { type: "resetTaxes" }
  | { type: "resetAll" };

export function propertyVsEtfReducer(
  s: PropertyVsEtfFormState,
  a: PropertyVsEtfAction,
): PropertyVsEtfFormState {
  switch (a.type) {
    case "setField": {
      // Nur die Objekt-Pflichtfelder dürfen leer (`null`) sein.
      if (a.value === null && !OBJECT_FIELDS.includes(a.field as ObjectFieldKey)) {
        return s;
      }
      return { ...s, [a.field]: a.value };
    }
    case "setEquity":
      return { ...s, equityMode: "manual", manualEquityCents: a.value };
    case "resetEquityToCosts":
      return { ...s, equityMode: "auto" };
    case "setTaxField":
      return { ...s, tax: { ...s.tax, [a.field]: a.value } };
    case "setTaxesEnabled":
      return { ...s, tax: { ...s.tax, taxesEnabled: a.value } };
    case "setReinvestSurplus":
      return { ...s, reinvestSurplus: a.value };
    case "resetAssumptions":
      return {
        ...s,
        ...assumptionDefaults(),
        reinvestSurplus: DEFAULT_REINVEST_SURPLUS,
      };
    case "resetTaxes":
      return { ...s, tax: taxDefaults() };
    case "resetAll":
      return createPropertyVsEtfFormState();
    default:
      return s;
  }
}

export function isAssumptionsModified(s: PropertyVsEtfFormState): boolean {
  const defaults = assumptionDefaults();
  return (
    ASSUMPTION_FIELDS.some((key) => s[key] !== defaults[key]) ||
    s.reinvestSurplus !== DEFAULT_REINVEST_SURPLUS
  );
}

export function isTaxModified(s: PropertyVsEtfFormState): boolean {
  const defaults = taxDefaults();
  return (Object.keys(defaults) as Array<keyof PropertyVsEtfTaxInput>).some(
    (key) => s.tax[key] !== defaults[key],
  );
}

/** Reglerbereiche der UI (immer innerhalb der Domänengrenzen). */
export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

export const PROPERTY_VS_ETF_UI_SLIDERS = {
  purchaseCostsBps: { min: 0, max: 1_500, step: 5 },
  interestRateBps: { min: 0, max: 1_000, step: 5 },
  initialRepaymentBps: { min: 0, max: 600, step: 10 },
  rentGrowthBps: { min: -200, max: 600, step: 10 },
  valueGrowthBps: { min: -300, max: 600, step: 10 },
  costGrowthBps: { min: 0, max: 600, step: 10 },
  vacancyBps: { min: 0, max: 1_000, step: 50 },
  maintenanceReserveBps: {
    min: PROPERTY_VS_ETF_SLIDER_RANGES.maintenanceReserveBps.min,
    max: PROPERTY_VS_ETF_SLIDER_RANGES.maintenanceReserveBps.max,
    step: 5,
  },
  etfAnnualReturnBps: { min: 0, max: 1_000, step: 10 },
  horizonYears: {
    min: PROPERTY_VS_ETF_SLIDER_RANGES.horizonYears.min,
    max: PROPERTY_VS_ETF_SLIDER_RANGES.horizonYears.max,
    step: 1,
  },
  marginalTaxRateBps: { min: 0, max: 5_000, step: 100 },
  depreciationRateBps: { min: 0, max: 400, step: 10 },
  buildingShareBps: { min: 0, max: 10_000, step: 500 },
  speculationPeriodYears: { min: 0, max: 15, step: 1 },
  partialExemptionBps: { min: 0, max: 10_000, step: 500 },
  brokerFeeBps: { min: 0, max: 700, step: 1 },
  otherSaleCostsBps: { min: 0, max: 200, step: 5 },
  reserveDeductionLagYears: { min: 0, max: 15, step: 1 },
} as const satisfies Record<string, SliderRange>;

export type SliderFieldKey = keyof typeof PROPERTY_VS_ETF_UI_SLIDERS;

/**
 * Wohnfläche in qm (z. B. „65,5“) → Hundertstel-qm. `null` bei leerer,
 * ungültiger oder negativer Eingabe.
 */
export function parseSqmInputToCentiSqm(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s*(qm|m²)$/i, "");
  if (cleaned.startsWith("-")) return null;
  return parseEuroInputToCents(cleaned);
}

export interface EquityResolution {
  purchaseCostsCents: number;
  minCents: number;
  maxCents: number;
  effectiveCents: number;
  clamped: "none" | "raised_to_costs" | "lowered_to_total";
}

/** `null`, solange der Kaufpreis fehlt oder die Grenzen nicht bildbar sind. */
export function resolveEquity(
  state: PropertyVsEtfFormState,
): EquityResolution | null {
  const price = state.purchasePriceCents;
  if (price === null) return null;
  try {
    const purchaseCostsCents = calculatePurchaseCostsCents(
      price,
      state.purchaseCostsBps,
    );
    // Reine Grenzbildung (entspricht totalCostCents), keine Finanzmathematik.
    const maxCents = price + purchaseCostsCents;
    if (!Number.isSafeInteger(maxCents)) return null;
    if (state.equityMode === "auto") {
      return {
        purchaseCostsCents,
        minCents: purchaseCostsCents,
        maxCents,
        effectiveCents: defaultEquityCents(price, state.purchaseCostsBps),
        clamped: "none",
      };
    }
    const manual = state.manualEquityCents;
    let effectiveCents = manual;
    let clamped: EquityResolution["clamped"] = "none";
    if (manual < purchaseCostsCents) {
      effectiveCents = purchaseCostsCents;
      clamped = "raised_to_costs";
    } else if (manual > maxCents) {
      effectiveCents = maxCents;
      clamped = "lowered_to_total";
    }
    return {
      purchaseCostsCents,
      minCents: purchaseCostsCents,
      maxCents,
      effectiveCents,
      clamped,
    };
  } catch {
    return null;
  }
}

export type PropertyVsEtfEvaluation =
  | { status: "empty"; missing: Array<"purchasePrice" | "livingArea" | "coldRent"> }
  | {
      status: "invalid";
      fieldErrors: Partial<Record<string, string>>;
      equity: EquityResolution | null;
    }
  | {
      status: "ok";
      input: PropertyVsEtfInput;
      tax: PropertyVsEtfTaxInput;
      result: PropertyVsEtfResult;
      equity: EquityResolution;
    };

export const FORM_ERROR_KEY = "_form";
export const UNCALCULABLE_MESSAGE =
  "Eingaben ergeben keinen rechenbaren Fall – bitte Werte prüfen.";

function collectErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  into: Partial<Record<string, string>>,
): void {
  for (const issue of issues) {
    const key = String(issue.path[0] ?? FORM_ERROR_KEY);
    if (into[key] === undefined) into[key] = issue.message;
  }
}

export function evaluatePropertyVsEtf(
  state: PropertyVsEtfFormState,
): PropertyVsEtfEvaluation {
  const missing: Array<"purchasePrice" | "livingArea" | "coldRent"> = [];
  if (state.purchasePriceCents === null) missing.push("purchasePrice");
  if (state.livingAreaCentiSqm === null) missing.push("livingArea");
  if (state.coldRentPerSqmCents === null) missing.push("coldRent");
  if (
    state.purchasePriceCents === null ||
    state.livingAreaCentiSqm === null ||
    state.coldRentPerSqmCents === null
  ) {
    return { status: "empty", missing };
  }

  const equity = resolveEquity(state);
  const baseInput = {
    purchasePriceCents: state.purchasePriceCents,
    livingAreaCentiSqm: state.livingAreaCentiSqm,
    coldRentPerSqmCents: state.coldRentPerSqmCents,
    purchaseCostsBps: state.purchaseCostsBps,
    interestRateBps: state.interestRateBps,
    initialRepaymentBps: state.initialRepaymentBps,
    rentGrowthBps: state.rentGrowthBps,
    valueGrowthBps: state.valueGrowthBps,
    costGrowthBps: state.costGrowthBps,
    vacancyBps: state.vacancyBps,
    monthlyHoaCostsCents: state.monthlyHoaCostsCents,
    maintenanceReserveBps: state.maintenanceReserveBps,
    etfAnnualReturnBps: state.etfAnnualReturnBps,
    horizonYears: state.horizonYears,
    reinvestSurplus: state.reinvestSurplus,
  };

  const fieldErrors: Partial<Record<string, string>> = {};
  const inputParse = propertyVsEtfInputSchema.safeParse({
    ...baseInput,
    equityCents: equity?.effectiveCents ?? 0,
  });
  if (!inputParse.success) {
    collectErrors(inputParse.error.issues, fieldErrors);
    if (equity === null) delete fieldErrors.equityCents;
  }
  const taxParse = propertyVsEtfTaxInputSchema.safeParse(state.tax);
  if (!taxParse.success) collectErrors(taxParse.error.issues, fieldErrors);

  if (equity === null && Object.keys(fieldErrors).length === 0) {
    fieldErrors[FORM_ERROR_KEY] = UNCALCULABLE_MESSAGE;
  }
  if (equity === null || !inputParse.success || !taxParse.success) {
    return { status: "invalid", fieldErrors, equity };
  }

  const input: PropertyVsEtfInput = inputParse.data;
  const tax: PropertyVsEtfTaxInput = taxParse.data;
  try {
    const result = simulatePropertyVsEtf(input, tax);
    return { status: "ok", input, tax, result, equity };
  } catch {
    return {
      status: "invalid",
      fieldErrors: { [FORM_ERROR_KEY]: UNCALCULABLE_MESSAGE },
      equity,
    };
  }
}

/**
 * Letztes gültiges Ergebnis für die gedimmte Anzeige: `ok` ersetzt es, `invalid`
 * behält es, `empty` (z. B. nach „Alles zurücksetzen“) verwirft es.
 */
export function nextLastOk(
  prev: Extract<PropertyVsEtfEvaluation, { status: "ok" }> | null,
  evaluation: PropertyVsEtfEvaluation,
): Extract<PropertyVsEtfEvaluation, { status: "ok" }> | null {
  if (evaluation.status === "ok") return evaluation;
  if (evaluation.status === "empty") return null;
  return prev;
}
