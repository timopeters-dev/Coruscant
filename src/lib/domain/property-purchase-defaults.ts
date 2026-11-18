export interface PurchaseCostItemInput {
  key: string;
  label: string;
  bps: number;
}

export interface PurchaseCostRuleSet {
  version: string;
  reviewedAt: string;
  note: string;
  items: readonly (PurchaseCostItemInput & { hint: string })[];
}

export const PROPERTY_PURCHASE_LIMITS = {
  purchasePriceCents: { min: 0, max: 10_000_000_000 },
  equityCents: { min: 0, max: 10_000_000_000 },
  interestRateBps: { min: 0, max: 1_500 },
  initialRepaymentBps: { min: 0, max: 1_000 },
  fixedRateYears: { min: 1, max: 40 },
  monthlyColdRentCents: { min: 0, max: 10_000_000 },
  monthlyNonRecoverableCostsCents: { min: 0, max: 10_000_000 },
  monthlyMaintenanceCents: { min: 0, max: 10_000_000 },
  costItems: {
    minCount: 1,
    maxCount: 10,
    minLabelLength: 1,
    maxLabelLength: 60,
    minBps: 0,
    maxBps: 2_000,
  },
} as const;

export const PURCHASE_COST_RULE_SETS: readonly PurchaseCostRuleSet[] = [
  {
    version: "2026-11",
    reviewedAt: "2026-11-18",
    note: "Richtwerte, regional abhängig – bitte mit Exposé und Notar prüfen.",
    items: [
      {
        key: "real_estate_transfer_tax",
        label: "Grunderwerbsteuer",
        bps: 650,
        hint: "je Bundesland unterschiedlich (3,5–6,5 %); Default = höchster Satz",
      },
      {
        key: "notary_land_registry",
        label: "Notar & Grundbuch",
        bps: 200,
        hint: "typisch 1,5–2,0 %",
      },
      {
        key: "broker",
        label: "Makler",
        bps: 357,
        hint: "inkl. USt; 0 % bei provisionsfreiem Kauf",
      },
    ],
  },
] as const;

export const CURRENT_PURCHASE_COST_RULE_SET: PurchaseCostRuleSet =
  PURCHASE_COST_RULE_SETS[PURCHASE_COST_RULE_SETS.length - 1]!;

/**
 * Fiktives Beispiel-Szenario für die Startbelegung des Kaufrechners (keine Richtwerte).
 */
export const PROPERTY_PURCHASE_EXAMPLE_SCENARIO = {
  purchasePriceCents: 25_000_000,
  requireEquityCoversCosts: true,
  interestRateBps: 350,
  initialRepaymentBps: 200,
  fixedRateYears: 10,
  monthlyColdRentCents: 80_000,
  monthlyNonRecoverableCostsCents: 6_000,
  monthlyMaintenanceCents: 5_000,
} as const;
