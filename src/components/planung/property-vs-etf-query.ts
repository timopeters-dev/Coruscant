import {
  calculatePurchaseCostsCents,
  PROPERTY_VS_ETF_LIMITS,
  PROPERTY_VS_ETF_TAX_LIMITS,
} from "@/lib/domain/property-vs-etf-defaults";
import type { PropertyPurchaseInput } from "@/lib/domain/property-purchase";
import { ALLOWED_CHURCH_TAX_BPS } from "@/lib/domain/scenarios";
import {
  coerceStrictInt,
  getParam,
  type RawSearchParams,
} from "@/lib/validation/query-params";
import {
  createPropertyVsEtfFormState,
  type NumericFieldKey,
  type PropertyVsEtfFormState,
  type TaxNumericFieldKey,
} from "./property-vs-etf-state";

export const PROPERTY_VS_ETF_DIALOG_PARAM = "dialog";
export const PROPERTY_VS_ETF_DIALOG_VALUE = "immo-etf";
const ORIGIN_PARAM = "von";
const ORIGIN_VALUE = "kaufrechner";
const EQUITY_KEY = "ek";
const TAXES_ENABLED_KEY = "steuer";

interface Range {
  min: number;
  max: number;
}

interface FieldDef {
  key: string;
  limits: Range;
}

/**
 * Schlüsseltabelle (Single Source of Truth für Lesen und Schreiben). Die
 * `satisfies`-Prüfung erzwingt je Formularfeld genau einen Schlüssel; die
 * Reihenfolge der Einträge bestimmt die Reihenfolge in der URL.
 */
const OBJECT_AND_COST_FIELDS = {
  purchasePriceCents: { key: "kp", limits: PROPERTY_VS_ETF_LIMITS.purchasePriceCents },
  livingAreaCentiSqm: { key: "wfl", limits: PROPERTY_VS_ETF_LIMITS.livingAreaCentiSqm },
  coldRentPerSqmCents: { key: "kmqm", limits: PROPERTY_VS_ETF_LIMITS.coldRentPerSqmCents },
  purchaseCostsBps: { key: "nk", limits: PROPERTY_VS_ETF_LIMITS.purchaseCostsBps },
} as const satisfies Partial<Record<NumericFieldKey, FieldDef>>;

const ASSUMPTION_FIELDS = {
  interestRateBps: { key: "zins", limits: PROPERTY_VS_ETF_LIMITS.interestRateBps },
  initialRepaymentBps: { key: "tilg", limits: PROPERTY_VS_ETF_LIMITS.initialRepaymentBps },
  rentGrowthBps: { key: "mst", limits: PROPERTY_VS_ETF_LIMITS.rentGrowthBps },
  valueGrowthBps: { key: "wst", limits: PROPERTY_VS_ETF_LIMITS.valueGrowthBps },
  costGrowthBps: { key: "kst", limits: PROPERTY_VS_ETF_LIMITS.costGrowthBps },
  vacancyBps: { key: "ausfall", limits: PROPERTY_VS_ETF_LIMITS.vacancyBps },
  monthlyHoaCostsCents: { key: "weg", limits: PROPERTY_VS_ETF_LIMITS.monthlyHoaCostsCents },
  maintenanceReserveBps: { key: "ihr", limits: PROPERTY_VS_ETF_LIMITS.maintenanceReserveBps },
  etfAnnualReturnBps: { key: "etf", limits: PROPERTY_VS_ETF_LIMITS.etfAnnualReturnBps },
  horizonYears: { key: "jahre", limits: PROPERTY_VS_ETF_LIMITS.horizonYears },
} as const satisfies Partial<Record<NumericFieldKey, FieldDef>>;

const TAX_FIELDS = {
  marginalTaxRateBps: { key: "gst", limits: PROPERTY_VS_ETF_TAX_LIMITS.marginalTaxRateBps },
  depreciationRateBps: { key: "afa", limits: PROPERTY_VS_ETF_TAX_LIMITS.depreciationRateBps },
  buildingShareBps: { key: "geb", limits: PROPERTY_VS_ETF_TAX_LIMITS.buildingShareBps },
  speculationPeriodYears: { key: "frist", limits: PROPERTY_VS_ETF_TAX_LIMITS.speculationPeriodYears },
  saverAllowanceCents: { key: "spb", limits: PROPERTY_VS_ETF_TAX_LIMITS.saverAllowanceCents },
  partialExemptionBps: { key: "tf", limits: PROPERTY_VS_ETF_TAX_LIMITS.partialExemptionBps },
  saleCostsBps: { key: "vk", limits: PROPERTY_VS_ETF_TAX_LIMITS.saleCostsBps },
} as const satisfies Partial<Record<TaxNumericFieldKey, FieldDef>>;

/** `kist` ist ein Aufzählungswert (kein Bereich) und steht daher separat. */
const CHURCH_TAX_KEY = "kist";

// Vollständigkeit: jedes numerische Formular- und Steuerfeld hat genau einen Schlüssel.
type CoveredFormKeys =
  | keyof typeof OBJECT_AND_COST_FIELDS
  | keyof typeof ASSUMPTION_FIELDS;
type CoveredTaxKeys = keyof typeof TAX_FIELDS | "churchTaxBps";
const _formComplete: Exclude<NumericFieldKey, CoveredFormKeys> extends never
  ? true
  : never = true;
const _taxComplete: Exclude<TaxNumericFieldKey, CoveredTaxKeys> extends never
  ? true
  : never = true;
void _formComplete;
void _taxComplete;

type Entry<T extends object> = [keyof T & string, FieldDef][];

const OBJECT_AND_COST_ENTRIES = Object.entries(
  OBJECT_AND_COST_FIELDS,
) as unknown as Entry<typeof OBJECT_AND_COST_FIELDS>;
const ASSUMPTION_ENTRIES = Object.entries(
  ASSUMPTION_FIELDS,
) as unknown as Entry<typeof ASSUMPTION_FIELDS>;
const TAX_ENTRIES = Object.entries(TAX_FIELDS) as unknown as Entry<
  typeof TAX_FIELDS
>;

export const PROPERTY_VS_ETF_QUERY_KEYS: readonly string[] = [
  PROPERTY_VS_ETF_DIALOG_PARAM,
  ORIGIN_PARAM,
  ...OBJECT_AND_COST_ENTRIES.map(([, d]) => d.key),
  EQUITY_KEY,
  ...ASSUMPTION_ENTRIES.map(([, d]) => d.key),
  TAXES_ENABLED_KEY,
  ...TAX_ENTRIES.map(([, d]) => d.key),
  CHURCH_TAX_KEY,
];

export interface PropertyVsEtfQueryState {
  open: boolean;
  state: PropertyVsEtfFormState;
  origin: "kaufrechner" | null;
}

function readInt(
  params: RawSearchParams,
  key: string,
  limits: Range,
): number | null {
  const parsed = coerceStrictInt(limits.min, limits.max).safeParse(
    getParam(params, key),
  );
  if (!parsed.success) return null;
  // „-0“ wird zu 0 normalisiert (kein negatives Null im Zustand).
  const value = parsed.data as number;
  return value === 0 ? 0 : value;
}

function isValidInt(value: unknown, limits: Range): value is number {
  return (
    typeof value === "number" &&
    coerceStrictInt(limits.min, limits.max).safeParse(value).success
  );
}

function emptyResult(): PropertyVsEtfQueryState {
  return { open: false, state: createPropertyVsEtfFormState(), origin: null };
}

/** Wirft nie. Ohne `dialog=immo-etf` → { open: false, state: Standard, origin: null }. */
export function parsePropertyVsEtfQuery(
  params: RawSearchParams,
): PropertyVsEtfQueryState {
  try {
    const dialog = getParam(params, PROPERTY_VS_ETF_DIALOG_PARAM);
    if (dialog === undefined || dialog.trim() !== PROPERTY_VS_ETF_DIALOG_VALUE) {
      return emptyResult();
    }

    const state = createPropertyVsEtfFormState();
    const mutable = state as unknown as Record<string, number | null>;

    for (const [field, def] of [
      ...OBJECT_AND_COST_ENTRIES,
      ...ASSUMPTION_ENTRIES,
    ]) {
      const value = readInt(params, def.key, def.limits);
      if (value !== null) mutable[field] = value;
    }

    const equity = readInt(
      params,
      EQUITY_KEY,
      PROPERTY_VS_ETF_LIMITS.equityCents,
    );
    if (equity !== null) {
      state.equityMode = "manual";
      state.manualEquityCents = equity;
    }

    const tax = state.tax as unknown as Record<string, number | boolean>;
    for (const [field, def] of TAX_ENTRIES) {
      const value = readInt(params, def.key, def.limits);
      if (value !== null) tax[field] = value;
    }
    const taxes = getParam(params, TAXES_ENABLED_KEY)?.trim();
    if (taxes === "0") state.tax.taxesEnabled = false;
    else if (taxes === "1") state.tax.taxesEnabled = true;

    const church = readInt(params, CHURCH_TAX_KEY, { min: 0, max: 10_000 });
    if (
      church !== null &&
      (ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(church)
    ) {
      state.tax.churchTaxBps = church;
    }

    const von = getParam(params, ORIGIN_PARAM)?.trim();
    return {
      open: true,
      state,
      origin: von === ORIGIN_VALUE ? "kaufrechner" : null,
    };
  } catch {
    return emptyResult();
  }
}

/** Nur Abweichungen vom Standard und nur Werte innerhalb der Grenzen; Reihenfolge = Tabelle. */
export function serializePropertyVsEtfState(
  state: PropertyVsEtfFormState,
): URLSearchParams {
  const out = new URLSearchParams();
  const defaults = createPropertyVsEtfFormState();
  const s = state as unknown as Record<string, unknown>;
  const d = defaults as unknown as Record<string, unknown>;

  const writeForm = (entries: Array<[string, FieldDef]>) => {
    for (const [field, def] of entries) {
      const value = s[field];
      if (value === null || value === undefined) continue;
      if (!isValidInt(value, def.limits)) continue;
      if (value === d[field]) continue;
      out.set(def.key, String(value));
    }
  };

  writeForm(OBJECT_AND_COST_ENTRIES);

  if (
    state.equityMode === "manual" &&
    isValidInt(state.manualEquityCents, PROPERTY_VS_ETF_LIMITS.equityCents)
  ) {
    out.set(EQUITY_KEY, String(state.manualEquityCents));
  }

  writeForm(ASSUMPTION_ENTRIES);

  if (!state.tax.taxesEnabled) out.set(TAXES_ENABLED_KEY, "0");

  const t = state.tax as unknown as Record<string, unknown>;
  const td = defaults.tax as unknown as Record<string, unknown>;
  const writeChurchTax = () => {
    if (
      (ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(
        state.tax.churchTaxBps,
      ) &&
      state.tax.churchTaxBps !== defaults.tax.churchTaxBps
    ) {
      out.set(CHURCH_TAX_KEY, String(state.tax.churchTaxBps));
    }
  };
  for (const [field, def] of TAX_ENTRIES) {
    // Reihenfolge laut Tabelle: ... tf, kist, vk.
    if (field === "saleCostsBps") writeChurchTax();
    const value = t[field];
    if (!isValidInt(value, def.limits)) continue;
    if (value === td[field]) continue;
    out.set(def.key, String(value));
  }

  return out;
}

/**
 * Entfernt alle PROPERTY_VS_ETF_QUERY_KEYS aus `currentSearch`, erhält den Rest in
 * Originalreihenfolge und hängt bei `open` dialog=immo-etf + serialisierte Felder an.
 * Rückgabe ohne führendes „?“ (leer = keine Query).
 */
export function mergePropertyVsEtfQuery(
  currentSearch: string,
  open: boolean,
  state: PropertyVsEtfFormState,
): string {
  const raw = currentSearch.startsWith("?")
    ? currentSearch.slice(1)
    : currentSearch;
  const reserved = new Set(PROPERTY_VS_ETF_QUERY_KEYS);
  const merged = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(raw).entries()) {
    if (!reserved.has(key)) merged.append(key, value);
  }
  if (open) {
    merged.append(PROPERTY_VS_ETF_DIALOG_PARAM, PROPERTY_VS_ETF_DIALOG_VALUE);
    for (const [key, value] of serializePropertyVsEtfState(state).entries()) {
      merged.append(key, value);
    }
  }
  return merged.toString();
}

/** Pfad + Query für `history.replaceState` bzw. „Link kopieren“. */
export function buildPropertyVsEtfHref(pathname: string, query: string): string {
  return query === "" ? pathname : `${pathname}?${query}`;
}

/**
 * Link „Mit ETF vergleichen“ aus dem Kaufrechner. Wohnfläche und Kaltmiete/qm
 * bleiben leer (der Kaufrechner kennt nur die Gesamtmiete).
 */
export function buildPropertyVsEtfHrefFromPurchase(
  input: Pick<
    PropertyPurchaseInput,
    | "purchasePriceCents"
    | "costItems"
    | "equityCents"
    | "interestRateBps"
    | "initialRepaymentBps"
    | "monthlyNonRecoverableCostsCents"
  >,
): string {
  const state = createPropertyVsEtfFormState();
  const defaultBps = state.purchaseCostsBps;

  state.purchasePriceCents = input.purchasePriceCents;
  state.purchaseCostsBps = input.costItems.reduce(
    (sum, item) => sum + item.bps,
    0,
  );
  state.interestRateBps = input.interestRateBps;
  state.initialRepaymentBps = input.initialRepaymentBps;
  state.monthlyHoaCostsCents = input.monthlyNonRecoverableCostsCents;

  // Außerhalb der Grenzen fällt `nk` beim Schreiben weg, es gilt dann der Standard.
  const effectiveBps = isValidInt(
    state.purchaseCostsBps,
    PROPERTY_VS_ETF_LIMITS.purchaseCostsBps,
  )
    ? state.purchaseCostsBps
    : defaultBps;
  let costsCents: number | null = null;
  try {
    costsCents = calculatePurchaseCostsCents(
      input.purchasePriceCents,
      effectiveBps,
    );
  } catch {
    costsCents = null;
  }
  if (costsCents === null || input.equityCents !== costsCents) {
    state.equityMode = "manual";
    state.manualEquityCents = input.equityCents;
  }

  const params = new URLSearchParams();
  params.set(PROPERTY_VS_ETF_DIALOG_PARAM, PROPERTY_VS_ETF_DIALOG_VALUE);
  params.set(ORIGIN_PARAM, ORIGIN_VALUE);
  for (const [key, value] of serializePropertyVsEtfState(state).entries()) {
    params.append(key, value);
  }
  return buildPropertyVsEtfHref("/planung", params.toString());
}
