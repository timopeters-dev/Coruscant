import {
  assertNonNegativeInteger,
  assertSafeInteger,
  divRoundHalfUpSigned,
  roundHalfUpBigInt,
} from "./money";
import {
  type DomainLinkedContract,
  type DomainPropertyDetail,
  type PropertySummary,
  type PropertyUsage,
  summarizeProperties,
} from "./properties";

const BPS_SCALE = 10_000n;
const MONTHS_PER_YEAR = 12n;

export interface DomainRentalProfile {
  monthlyColdRentCents: number | null;
  monthlyNonRecoverableCostsCents: number | null;
  monthlyMaintenanceAllowanceCents: number | null;
  depreciationBasisCents: number | null;
}

export type RentalProfileField = keyof DomainRentalProfile;

const RENTAL_PROFILE_FIELDS: readonly RentalProfileField[] = [
  "monthlyColdRentCents",
  "monthlyNonRecoverableCostsCents",
  "monthlyMaintenanceAllowanceCents",
  "depreciationBasisCents",
];

/**
 * Profil-Regel: Mietfelder sind nur bei `usage === 'rented'` zulässig.
 * Liefert Feldfehler, wirft nicht.
 */
export function validateRentalProfile(
  usage: PropertyUsage,
  profile: Partial<DomainRentalProfile>,
): Partial<Record<RentalProfileField, string>> {
  if (usage === "rented") {
    return {};
  }

  const errors: Partial<Record<RentalProfileField, string>> = {};
  for (const field of RENTAL_PROFILE_FIELDS) {
    if (profile[field] != null) {
      errors[field] = "Nur bei vermieteten Objekten zulässig.";
    }
  }
  return errors;
}

export interface DomainRentalProperty
  extends DomainPropertyDetail,
    DomainRentalProfile {
  maintenanceReservePotId?: string | null;
}

export type RentalWarning =
  | { kind: "negative_equity" }
  | { kind: "missing_purchase_price" };

export interface RentalMetrics {
  propertyId: string;
  monthlyColdRentCents: number;
  monthlyNonRecoverableCostsCents: number;
  monthlyMaintenanceAllowanceCents: number;
  monthlyLoanRatesCents: number;
  monthlySavingsRatesCents: number;
  netCashflowBeforeReserveCents: number;
  netCashflowAfterReserveCents: number;
  grossYieldBps: number | null;
  netYieldBps: number | null;
  estimatedValueCents: number;
  linkedLoanBalanceCents: number;
  linkedSavingsBalanceCents: number;
  capitalTiedCents: number;
  ltvBps: number | null;
  warnings: RentalWarning[];
}

export interface RentalPortfolioSummary {
  hasData: boolean;
  propertyCount: number;
  propertyIds: string[];
  totals: Omit<
    RentalMetrics,
    "propertyId" | "grossYieldBps" | "netYieldBps" | "ltvBps" | "warnings"
  >;
  grossYieldBps: number | null;
  netYieldBps: number | null;
  yieldCoverage: "all" | "partial" | "none";
  ltvBps: number | null;
  items: RentalMetrics[];
  warningCount: number;
}

/**
 * Berechnet die Vermietungs-Kennzahlen für ein einzelnes Objekt vor Steuern.
 */
export function calculateRentalMetrics(
  property: DomainRentalProperty,
  summary: PropertySummary,
  contracts: readonly DomainLinkedContract[],
): RentalMetrics {
  const monthlyColdRentCents = assertNonNegativeInteger(
    property.monthlyColdRentCents ?? 0,
    "monthlyColdRentCents",
  );
  const monthlyNonRecoverableCostsCents = assertNonNegativeInteger(
    property.monthlyNonRecoverableCostsCents ?? 0,
    "monthlyNonRecoverableCostsCents",
  );
  const monthlyMaintenanceAllowanceCents = assertNonNegativeInteger(
    property.monthlyMaintenanceAllowanceCents ?? 0,
    "monthlyMaintenanceAllowanceCents",
  );
  if (property.depreciationBasisCents != null) {
    assertNonNegativeInteger(
      property.depreciationBasisCents,
      "depreciationBasisCents",
    );
  }

  const purchasePriceCents =
    property.purchasePriceCents != null
      ? assertNonNegativeInteger(
          property.purchasePriceCents,
          "purchasePriceCents",
        )
      : null;

  const estimatedValueCents = assertNonNegativeInteger(
    summary.estimatedValueCents,
    "estimatedValueCents",
  );
  const linkedLoanBalanceCents = assertNonNegativeInteger(
    summary.linkedLoanBalanceCents,
    "linkedLoanBalanceCents",
  );
  const linkedSavingsBalanceCents = assertNonNegativeInteger(
    summary.linkedSavingsBalanceCents,
    "linkedSavingsBalanceCents",
  );
  const capitalTiedCents = assertSafeInteger(
    summary.netEquityCents,
    "capitalTiedCents",
  );

  let monthlyLoanRatesCents = 0;
  let monthlySavingsRatesCents = 0;
  const warnings: RentalWarning[] = [];

  for (const contract of contracts) {
    if (contract.linkedPropertyId !== property.id) {
      continue;
    }
    if (contract.status === "closed") {
      continue;
    }

    if (contract.status === "active") {
      const rateCents = assertNonNegativeInteger(
        contract.monthlyRateCents,
        "monthlyRateCents",
      );
      if (contract.category === "loan") {
        monthlyLoanRatesCents = assertSafeInteger(
          monthlyLoanRatesCents + rateCents,
          "monthlyLoanRatesCents",
        );
      } else {
        monthlySavingsRatesCents = assertSafeInteger(
          monthlySavingsRatesCents + rateCents,
          "monthlySavingsRatesCents",
        );
      }
    }
  }

  const netCashflowBeforeReserveCents = assertSafeInteger(
    monthlyColdRentCents -
      monthlyNonRecoverableCostsCents -
      monthlyLoanRatesCents -
      monthlySavingsRatesCents,
    "netCashflowBeforeReserveCents",
  );
  const netCashflowAfterReserveCents = assertSafeInteger(
    netCashflowBeforeReserveCents - monthlyMaintenanceAllowanceCents,
    "netCashflowAfterReserveCents",
  );

  let grossYieldBps: number | null = null;
  let netYieldBps: number | null = null;
  if (purchasePriceCents != null && purchasePriceCents > 0) {
    const priceBig = BigInt(purchasePriceCents);
    grossYieldBps = divRoundHalfUpSigned(
      MONTHS_PER_YEAR * BigInt(monthlyColdRentCents) * BPS_SCALE,
      priceBig,
    );
    const monthlyNetOperatingCents =
      monthlyColdRentCents -
      monthlyNonRecoverableCostsCents -
      monthlyMaintenanceAllowanceCents;
    netYieldBps = divRoundHalfUpSigned(
      MONTHS_PER_YEAR * BigInt(monthlyNetOperatingCents) * BPS_SCALE,
      priceBig,
    );
  } else {
    warnings.push({ kind: "missing_purchase_price" });
  }

  if (capitalTiedCents < 0) {
    warnings.push({ kind: "negative_equity" });
  }

  return {
    propertyId: property.id,
    monthlyColdRentCents,
    monthlyNonRecoverableCostsCents,
    monthlyMaintenanceAllowanceCents,
    monthlyLoanRatesCents,
    monthlySavingsRatesCents,
    netCashflowBeforeReserveCents,
    netCashflowAfterReserveCents,
    grossYieldBps,
    netYieldBps,
    estimatedValueCents,
    linkedLoanBalanceCents,
    linkedSavingsBalanceCents,
    capitalTiedCents,
    ltvBps: summary.ltvBps,
    warnings,
  };
}

/**
 * Aggregiert alle vermieteten Objekte (`usage === 'rented'`) zu einer Portfolio-Sicht vor Steuern.
 */
export function summarizeRentalPortfolio(
  properties: readonly DomainRentalProperty[],
  contracts: readonly DomainLinkedContract[],
  asOfDate: string,
): RentalPortfolioSummary {
  const summaries = summarizeProperties(properties, contracts, asOfDate);
  const rentedProperties = properties.filter((p) => p.usage === "rented");

  if (rentedProperties.length === 0) {
    return {
      hasData: false,
      propertyCount: 0,
      propertyIds: [],
      totals: {
        monthlyColdRentCents: 0,
        monthlyNonRecoverableCostsCents: 0,
        monthlyMaintenanceAllowanceCents: 0,
        monthlyLoanRatesCents: 0,
        monthlySavingsRatesCents: 0,
        netCashflowBeforeReserveCents: 0,
        netCashflowAfterReserveCents: 0,
        estimatedValueCents: 0,
        linkedLoanBalanceCents: 0,
        linkedSavingsBalanceCents: 0,
        capitalTiedCents: 0,
      },
      grossYieldBps: null,
      netYieldBps: null,
      yieldCoverage: "none",
      ltvBps: null,
      items: [],
      warningCount: 0,
    };
  }

  const items: RentalMetrics[] = [];
  const propertyIds: string[] = [];

  let monthlyColdRentCents = 0;
  let monthlyNonRecoverableCostsCents = 0;
  let monthlyMaintenanceAllowanceCents = 0;
  let monthlyLoanRatesCents = 0;
  let monthlySavingsRatesCents = 0;
  let netCashflowBeforeReserveCents = 0;
  let netCashflowAfterReserveCents = 0;
  let estimatedValueCents = 0;
  let linkedLoanBalanceCents = 0;
  let linkedSavingsBalanceCents = 0;
  let capitalTiedCents = 0;
  let warningCount = 0;

  let pricedCount = 0;
  let totalPurchasePriceBig = 0n;
  let totalAnnualRentBig = 0n;
  let totalAnnualNetOperatingBig = 0n;

  for (const property of rentedProperties) {
    const summary = summaries[property.id];
    if (!summary) {
      continue;
    }

    const metrics = calculateRentalMetrics(property, summary, contracts);
    items.push(metrics);
    propertyIds.push(property.id);

    monthlyColdRentCents = assertSafeInteger(
      monthlyColdRentCents + metrics.monthlyColdRentCents,
      "totals.monthlyColdRentCents",
    );
    monthlyNonRecoverableCostsCents = assertSafeInteger(
      monthlyNonRecoverableCostsCents + metrics.monthlyNonRecoverableCostsCents,
      "totals.monthlyNonRecoverableCostsCents",
    );
    monthlyMaintenanceAllowanceCents = assertSafeInteger(
      monthlyMaintenanceAllowanceCents +
        metrics.monthlyMaintenanceAllowanceCents,
      "totals.monthlyMaintenanceAllowanceCents",
    );
    monthlyLoanRatesCents = assertSafeInteger(
      monthlyLoanRatesCents + metrics.monthlyLoanRatesCents,
      "totals.monthlyLoanRatesCents",
    );
    monthlySavingsRatesCents = assertSafeInteger(
      monthlySavingsRatesCents + metrics.monthlySavingsRatesCents,
      "totals.monthlySavingsRatesCents",
    );
    netCashflowBeforeReserveCents = assertSafeInteger(
      netCashflowBeforeReserveCents + metrics.netCashflowBeforeReserveCents,
      "totals.netCashflowBeforeReserveCents",
    );
    netCashflowAfterReserveCents = assertSafeInteger(
      netCashflowAfterReserveCents + metrics.netCashflowAfterReserveCents,
      "totals.netCashflowAfterReserveCents",
    );
    estimatedValueCents = assertSafeInteger(
      estimatedValueCents + metrics.estimatedValueCents,
      "totals.estimatedValueCents",
    );
    linkedLoanBalanceCents = assertSafeInteger(
      linkedLoanBalanceCents + metrics.linkedLoanBalanceCents,
      "totals.linkedLoanBalanceCents",
    );
    linkedSavingsBalanceCents = assertSafeInteger(
      linkedSavingsBalanceCents + metrics.linkedSavingsBalanceCents,
      "totals.linkedSavingsBalanceCents",
    );
    capitalTiedCents = assertSafeInteger(
      capitalTiedCents + metrics.capitalTiedCents,
      "totals.capitalTiedCents",
    );
    warningCount += metrics.warnings.length;

    if (
      property.purchasePriceCents != null &&
      property.purchasePriceCents > 0
    ) {
      pricedCount += 1;
      totalPurchasePriceBig += BigInt(property.purchasePriceCents);
      totalAnnualRentBig +=
        MONTHS_PER_YEAR * BigInt(metrics.monthlyColdRentCents);
      const monthlyNet =
        metrics.monthlyColdRentCents -
        metrics.monthlyNonRecoverableCostsCents -
        metrics.monthlyMaintenanceAllowanceCents;
      totalAnnualNetOperatingBig += MONTHS_PER_YEAR * BigInt(monthlyNet);
    }
  }

  let yieldCoverage: "all" | "partial" | "none" = "none";
  if (pricedCount === rentedProperties.length) {
    yieldCoverage = "all";
  } else if (pricedCount > 0) {
    yieldCoverage = "partial";
  }

  const grossYieldBps =
    totalPurchasePriceBig > 0n
      ? divRoundHalfUpSigned(
          totalAnnualRentBig * BPS_SCALE,
          totalPurchasePriceBig,
        )
      : null;
  const netYieldBps =
    totalPurchasePriceBig > 0n
      ? divRoundHalfUpSigned(
          totalAnnualNetOperatingBig * BPS_SCALE,
          totalPurchasePriceBig,
        )
      : null;

  const ltvBps =
    estimatedValueCents > 0
      ? assertSafeInteger(
          Number(
            roundHalfUpBigInt(
              BigInt(linkedLoanBalanceCents) * BPS_SCALE,
              BigInt(estimatedValueCents),
            ),
          ),
          "portfolio.ltvBps",
        )
      : null;

  return {
    hasData: true,
    propertyCount: items.length,
    propertyIds,
    totals: {
      monthlyColdRentCents,
      monthlyNonRecoverableCostsCents,
      monthlyMaintenanceAllowanceCents,
      monthlyLoanRatesCents,
      monthlySavingsRatesCents,
      netCashflowBeforeReserveCents,
      netCashflowAfterReserveCents,
      estimatedValueCents,
      linkedLoanBalanceCents,
      linkedSavingsBalanceCents,
      capitalTiedCents,
    },
    grossYieldBps,
    netYieldBps,
    yieldCoverage,
    ltvBps,
    items,
    warningCount,
  };
}

/**
 * UI-Default für das Steuer-Tagging bei Belegzuordnung; keine Berechnung.
 */
export function suggestTaxCategoryForPropertyUsage(
  usage: PropertyUsage,
): "werbungskosten_vv" | null {
  return usage === "rented" ? "werbungskosten_vv" : null;
}
