import type { QuotaSnapshot } from "@/lib/domain/auto-valuation-schedule";
import { parseIsoDate } from "@/lib/domain/date";
import { assertNonNegativeInteger, assertSafeInteger } from "@/lib/domain/money";
import type { PropertyType } from "@/lib/domain/property-types";
import type {
  NormalizedValuationResult,
  ValuationConfidence,
  ValuationFactor,
} from "@/lib/domain/property-valuation";
import {
  ValuationContextPiiError,
  type PropertyValuationContext,
  type PropertyValuationEnergyClass,
} from "@/lib/domain/property-valuation-context";
import type { ImmoAnalyseValuationResponse } from "@/lib/validation/immoanalyse";

export interface ImmoAnalyseValuationRequest {
  haustyp: PropertyType;
  plz: string;
  ort?: string;
  wohnflaeche: number;
  grundstuecksflaeche?: number;
  baujahr?: number;
  energieklasse?: PropertyValuationEnergyClass;
  kaltmiete?: number;
  vermietet: boolean;
}

const FORBIDDEN_REQUEST_KEYS = new Set([
  "adresse",
  "strasse",
  "straße",
  "hausnummer",
  "lat",
  "lon",
  "lng",
  "latitude",
  "longitude",
  "kaufpreis",
  "meta",
  "name",
  "features",
  "ausstattung",
  "renovations",
  "sanierungen",
]);

function centsToEuroNumber(cents: number): number {
  const safeCents = assertNonNegativeInteger(cents, "monthlyColdRentCents");
  const euros = Math.floor(safeCents / 100);
  const rest = safeCents % 100;
  if (rest === 0) {
    return euros;
  }
  return Number(`${euros}.${String(rest).padStart(2, "0")}`);
}

export function buildImmoAnalyseRequest(
  context: PropertyValuationContext,
): ImmoAnalyseValuationRequest {
  const body: ImmoAnalyseValuationRequest = {
    haustyp: context.object.propertyType,
    plz: context.location.postalCode,
    wohnflaeche: context.object.livingAreaSqm,
    vermietet: context.object.usage === "rented",
  };

  if (context.location.city !== null) {
    body.ort = context.location.city;
  }
  if (context.object.plotAreaSqm !== null && context.object.plotAreaSqm > 0) {
    body.grundstuecksflaeche = context.object.plotAreaSqm;
  }
  if (
    context.object.constructionYear !== null &&
    context.object.constructionYear >= 1500 &&
    context.object.constructionYear <= 2031
  ) {
    body.baujahr = context.object.constructionYear;
  }
  if (context.object.energyClass !== null) {
    body.energieklasse = context.object.energyClass;
  }
  if (context.rental !== null) {
    body.kaltmiete = centsToEuroNumber(context.rental.monthlyColdRentCents);
  }

  return body;
}

export function assertRequestHasNoAddress(body: unknown): void {
  if (typeof body !== "object" || body === null) {
    throw new ValuationContextPiiError("Ungültiger Request-Body.");
  }
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_REQUEST_KEYS.has(key.toLowerCase())) {
      throw new ValuationContextPiiError(
        `Verbotenes Feld im Request-Body: ${key}`,
      );
    }
  }
}

export function serializeImmoAnalyseRequest(
  body: ImmoAnalyseValuationRequest,
): string {
  return JSON.stringify(body, null, 2);
}

export function eurNumberToCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  const fixed = value.toFixed(2);
  if (fixed.startsWith("-")) {
    return null;
  }
  const [wholeStr, fracStr = "00"] = fixed.split(".");
  if (!wholeStr) {
    return null;
  }
  const cents = Number(wholeStr) * 100 + Number(fracStr);
  try {
    return assertSafeInteger(cents, "eurNumberToCents");
  } catch {
    return null;
  }
}

export function normalizeDataAsOf(
  raw: string | null | undefined,
  fallbackDate: string,
): string {
  if (!raw) {
    return fallbackDate;
  }
  const trimmed = raw.trim();
  let candidate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    candidate = trimmed;
  } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}-01`;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    candidate = trimmed.slice(0, 10);
  }
  if (!candidate) {
    return fallbackDate;
  }
  try {
    parseIsoDate(candidate, "data_as_of");
    return candidate;
  } catch {
    return fallbackDate;
  }
}

function mapConfidenceLevel(
  level: "hoch" | "mittel" | "niedrig" | undefined,
): ValuationConfidence {
  switch (level) {
    case "hoch":
      return "high";
    case "mittel":
      return "medium";
    case "niedrig":
    default:
      return "low";
  }
}

export function normalizeImmoAnalyseResult(
  parsed: ImmoAnalyseValuationResponse,
  fallbackAsOfDate: string,
): NormalizedValuationResult {
  const posten = parsed.kennzahlen?.merkmal_anpassung?.posten ?? [];
  const factors: ValuationFactor[] = posten.slice(0, 6).map((item) => ({
    label: item.label.trim().slice(0, 80),
    effect:
      item.prozent > 0 ? "up" : item.prozent < 0 ? "down" : "neutral",
  }));

  const limitations = (parsed.bewertbarkeit.limitations ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);

  const rationale = (parsed.bewertbarkeit.begruendung ?? "")
    .trim()
    .slice(0, 800);

  return {
    requestId: parsed.request_id,
    cached: parsed.cached ?? false,
    valuability: parsed.bewertbarkeit.status,
    lowerCents: parsed.marktwert ? eurNumberToCents(parsed.marktwert.min) : null,
    medianCents: parsed.marktwert
      ? eurNumberToCents(parsed.marktwert.median)
      : null,
    upperCents: parsed.marktwert ? eurNumberToCents(parsed.marktwert.max) : null,
    asOfDate: normalizeDataAsOf(parsed.data_as_of, fallbackAsOfDate),
    confidence: mapConfidenceLevel(parsed.konfidenz?.level),
    confidenceScore: parsed.konfidenz?.wert ?? null,
    rationale,
    limitations,
    factors,
  };
}

export function normalizeQuota(
  kontingent: ImmoAnalyseValuationResponse["kontingent"],
  observedAt?: string,
): QuotaSnapshot | null {
  if (!kontingent) {
    return null;
  }
  return {
    limit: kontingent.limit,
    used: kontingent.verbraucht,
    remaining: kontingent.verbleibend,
    resetAt: kontingent.reset_at ?? null,
    tariff: kontingent.tarif ?? null,
    ...(observedAt ? { observedAt } : {}),
  };
}
