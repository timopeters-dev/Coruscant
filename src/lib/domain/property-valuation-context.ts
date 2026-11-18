import { parseIsoDate, toYearMonth } from "./date";
import { assertNonNegativeInteger, roundHalfUpBigInt } from "./money";
import {
  containsEmail,
  containsIban,
  containsLongDigitRun,
} from "./pii-patterns";
import type { PropertyUsage } from "./properties";
import {
  normalizeRenovations,
  type Renovation,
  type RenovationKind,
} from "./property-renovations";
import type { PropertyType } from "./property-types";

export type PropertyValuationEnergyClass =
  | "A+"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H";

export interface PropertyValuationContextInput {
  asOfDate: string;
  usage: PropertyUsage;
  propertyType: PropertyType | null;
  postalCode: string | null;
  city: string | null;
  livingAreaSqm: number | null;
  plotAreaSqm: number | null;
  constructionYear: number | null;
  energyClass: PropertyValuationEnergyClass | null;
  renovations: Renovation[];
  monthlyColdRentCents: number | null;
  forbiddenTerms: {
    street: string | null;
    houseNumber: string | null;
  };
}

export interface PropertyValuationContext {
  schemaVersion: 2;
  asOfMonth: string;
  location: {
    country: "DE";
    postalCode: string;
    city: string | null;
  };
  object: {
    usage: PropertyUsage;
    propertyType: PropertyType;
    livingAreaSqm: number;
    plotAreaSqm: number | null;
    constructionYear: number | null;
    energyClass: PropertyValuationEnergyClass | null;
    renovations: { year: number; kind: RenovationKind }[];
  };
  rental: {
    monthlyColdRentCents: number;
    rentPerSqmCents: number;
  } | null;
}

export type ValuationContextUnavailableReason =
  | "missing_postal_code"
  | "missing_living_area"
  | "missing_property_type";

export type BuildValuationContextResult =
  | { ok: true; context: PropertyValuationContext }
  | { ok: false; reason: ValuationContextUnavailableReason };

export class ValuationContextPiiError extends Error {
  constructor(message = "Kontext enthält potenziell personenbezogene Daten.") {
    super(message);
    this.name = "ValuationContextPiiError";
  }
}

const POSTAL_CODE_DE_REGEX = /^\d{5}$/;
const MAX_CITY_LENGTH = 60;
const CITY_ALLOWED_CHARS_REGEX = /^[\p{L} .'\-()/]+$/u;
const CITY_FORBIDDEN_STREET_TOKENS_REGEX =
  /(?:str\.|straße|strasse|weg|gasse|allee|platz)(?=$|[\s.,\-()/])/iu;

export function normalizePostalCode(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return POSTAL_CODE_DE_REGEX.test(trimmed) ? trimmed : null;
}

export function sanitizeCity(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_CITY_LENGTH) {
    return null;
  }
  if (!CITY_ALLOWED_CHARS_REGEX.test(normalized)) {
    return null;
  }
  if (CITY_FORBIDDEN_STREET_TOKENS_REGEX.test(normalized)) {
    return null;
  }
  if (containsIban(normalized) || containsEmail(normalized)) {
    return null;
  }
  return normalized;
}

export function buildPropertyValuationContext(
  input: PropertyValuationContextInput,
): BuildValuationContextResult {
  const asOfParts = parseIsoDate(input.asOfDate, "asOfDate");
  const asOfMonth = toYearMonth(input.asOfDate);

  const postalCode = normalizePostalCode(input.postalCode);
  if (!postalCode) {
    return { ok: false, reason: "missing_postal_code" };
  }

  if (
    input.livingAreaSqm == null ||
    !Number.isInteger(input.livingAreaSqm) ||
    input.livingAreaSqm <= 0
  ) {
    return { ok: false, reason: "missing_living_area" };
  }

  if (input.propertyType == null) {
    return { ok: false, reason: "missing_property_type" };
  }

  const livingAreaSqm = assertNonNegativeInteger(
    input.livingAreaSqm,
    "livingAreaSqm",
  );

  const plotAreaSqm =
    input.plotAreaSqm != null && input.plotAreaSqm > 0
      ? assertNonNegativeInteger(input.plotAreaSqm, "plotAreaSqm")
      : null;

  const constructionYear =
    input.constructionYear != null
      ? assertNonNegativeInteger(input.constructionYear, "constructionYear")
      : null;

  const filteredRenovations = normalizeRenovations(input.renovations).filter(
    (item) => {
      if (item.year > asOfParts.year) {
        return false;
      }
      if (constructionYear != null && item.year < constructionYear) {
        return false;
      }
      return true;
    },
  );

  let rental: PropertyValuationContext["rental"] = null;
  if (
    input.usage === "rented" &&
    input.monthlyColdRentCents != null &&
    input.monthlyColdRentCents > 0
  ) {
    const monthlyColdRentCents = assertNonNegativeInteger(
      input.monthlyColdRentCents,
      "monthlyColdRentCents",
    );
    const rentPerSqmCents = Number(
      roundHalfUpBigInt(BigInt(monthlyColdRentCents), BigInt(livingAreaSqm)),
    );
    rental = {
      monthlyColdRentCents,
      rentPerSqmCents,
    };
  }

  const context: PropertyValuationContext = {
    schemaVersion: 2,
    asOfMonth,
    location: {
      country: "DE",
      postalCode,
      city: sanitizeCity(input.city),
    },
    object: {
      usage: input.usage,
      propertyType: input.propertyType,
      livingAreaSqm,
      plotAreaSqm,
      constructionYear,
      energyClass: input.energyClass ?? null,
      renovations: filteredRenovations.map((item) => ({
        year: item.year,
        kind: item.kind,
      })),
    },
    rental,
  };

  return { ok: true, context };
}

function collectStringValues(context: PropertyValuationContext): string[] {
  const values: string[] = [
    context.asOfMonth,
    context.location.country,
    context.location.postalCode,
    context.object.usage,
    context.object.propertyType,
  ];
  if (context.location.city != null) {
    values.push(context.location.city);
  }
  if (context.object.energyClass != null) {
    values.push(context.object.energyClass);
  }
  for (const item of context.object.renovations) {
    values.push(item.kind);
  }
  return values;
}

export function assertValuationContextSafe(
  context: PropertyValuationContext,
  forbiddenTerms: { street: string | null; houseNumber: string | null },
): void {
  const forbidden: string[] = [];
  const street = forbiddenTerms.street?.trim() ?? "";
  const houseNumber = forbiddenTerms.houseNumber?.trim() ?? "";

  if (street.length >= 3) {
    forbidden.push(street.toLowerCase());
    if (houseNumber.length > 0) {
      forbidden.push(`${street} ${houseNumber}`.toLowerCase());
      forbidden.push(`${street}${houseNumber}`.toLowerCase());
    }
  }

  for (const value of collectStringValues(context)) {
    if (
      containsIban(value) ||
      containsEmail(value) ||
      containsLongDigitRun(value, 8)
    ) {
      throw new ValuationContextPiiError();
    }
    const lower = value.toLowerCase();
    for (const term of forbidden) {
      if (lower.includes(term)) {
        throw new ValuationContextPiiError();
      }
    }
  }
}

export function serializePropertyValuationContext(
  context: PropertyValuationContext,
): string {
  return JSON.stringify(context, null, 2);
}
