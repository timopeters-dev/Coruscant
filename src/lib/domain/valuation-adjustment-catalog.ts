import type { PropertyType } from "./property-types";
import {
  applyValuationAdjustment,
  MAX_VALUATION_ADJUSTMENTS,
  normalizeAdjustmentLabel,
  sumAdjustmentBps,
  type ValidateValuationAdjustmentsResult,
  validateValuationAdjustments,
  type ValuationAdjustment,
} from "./property-valuation-adjustments";
import {
  getCatalogItem,
  VALUATION_ADJUSTMENT_CATALOG,
  VALUATION_CATALOG_GROUPS,
  VALUATION_CATALOG_VERSION,
  type ValuationCatalogGroupId,
  type ValuationCatalogItem,
} from "./valuation-adjustment-catalog-data";

export {
  getCatalogItem,
  VALUATION_ADJUSTMENT_CATALOG,
  VALUATION_CATALOG_GROUPS,
  VALUATION_CATALOG_VERSION,
  type ValuationCatalogGroupId,
  type ValuationCatalogItem,
};

const CATALOG_BY_NORMALIZED_LABEL = new Map<string, ValuationCatalogItem>(
  VALUATION_ADJUSTMENT_CATALOG.map((item) => [
    normalizeAdjustmentLabel(item.label).toLocaleLowerCase("de-DE"),
    item,
  ]),
);

/**
 * Returns catalog items applicable to the given property type (`null` returns all items).
 */
export function catalogItemsFor(
  propertyType: PropertyType | null,
): ValuationCatalogItem[] {
  if (propertyType === null) {
    return [...VALUATION_ADJUSTMENT_CATALOG];
  }
  return VALUATION_ADJUSTMENT_CATALOG.filter(
    (item) => !item.appliesTo || item.appliesTo.includes(propertyType),
  );
}

/**
 * Matches a free-text label against the catalog (whitespace-normalized, case-insensitive de-DE).
 */
export function matchCatalogItemByLabel(
  label: string,
): ValuationCatalogItem | null {
  const key = normalizeAdjustmentLabel(label).toLocaleLowerCase("de-DE");
  return CATALOG_BY_NORMALIZED_LABEL.get(key) ?? null;
}

/**
 * Upgrades legacy adjustments without `catalogKey` to catalog items when their label matches.
 */
export function reconcileWithCatalog(
  list: readonly ValuationAdjustment[],
): ValuationAdjustment[] {
  return list.map((item) => {
    if (item.catalogKey !== undefined) {
      const known = getCatalogItem(item.catalogKey);
      if (known) {
        return { label: known.label, bps: item.bps, catalogKey: known.key };
      }
      return { label: item.label, bps: item.bps };
    }
    const matched = matchCatalogItemByLabel(item.label);
    if (matched) {
      return { label: matched.label, bps: item.bps, catalogKey: matched.key };
    }
    return { label: item.label, bps: item.bps };
  });
}

export type CatalogToggleResult =
  | { action: "add"; item: ValuationCatalogItem; replaceKeys: string[] }
  | { action: "remove"; key: string }
  | { action: "blocked"; reason: "too_many" };

/**
 * Resolves clicking a catalog chip against the current selection, handling exclusive swaps and the 8-item limit.
 */
export function resolveCatalogToggle(
  selected: readonly ValuationAdjustment[],
  key: string,
): CatalogToggleResult {
  const item = getCatalogItem(key);
  if (!item) {
    throw new RangeError(`Unknown valuation catalog key: "${key}"`);
  }

  if (selected.some((entry) => entry.catalogKey === key)) {
    return { action: "remove", key };
  }

  const replaceKeys: string[] = [];
  if (item.exclusiveGroup) {
    for (const entry of selected) {
      if (!entry.catalogKey) continue;
      const existing = getCatalogItem(entry.catalogKey);
      if (existing && existing.exclusiveGroup === item.exclusiveGroup) {
        replaceKeys.push(existing.key);
      }
    }
  }

  if (selected.length - replaceKeys.length + 1 > MAX_VALUATION_ADJUSTMENTS) {
    return { action: "blocked", reason: "too_many" };
  }

  return { action: "add", item, replaceKeys };
}

/**
 * Validates an adjustment draft and computes total bps and adjusted value when valid.
 */
export function summarizeAdjustmentDraft(
  list: readonly ValuationAdjustment[],
  baseCents: number | null,
): {
  validation: ValidateValuationAdjustmentsResult;
  totalBps: number | null;
  adjustedCents: number | null;
} {
  if (list.length === 0) {
    return {
      validation: { ok: true },
      totalBps: 0,
      adjustedCents: baseCents,
    };
  }

  const validation = validateValuationAdjustments(list);
  if (!validation.ok) {
    return {
      validation,
      totalBps: null,
      adjustedCents: null,
    };
  }

  const totalBps = sumAdjustmentBps(list);
  const adjustedCents =
    baseCents !== null ? applyValuationAdjustment(baseCents, totalBps) : null;

  return {
    validation,
    totalBps,
    adjustedCents,
  };
}
