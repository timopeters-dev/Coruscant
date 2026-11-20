import {
  assertNonNegativeInteger, assertSafeInteger, roundHalfUpBigInt,
} from "@/domain/core/money";

export const MAX_SCENARIO_MONTHS = 480;
export const DEFAULT_CASHFLOW_HORIZON_MONTHS = 360;
export const MIN_ETF_RETURN_BPS = -5000;
export const MAX_ETF_RETURN_BPS = 3000;
export const SOLI_BPS = 550;
export const PARTIAL_EXEMPTION_EQUITY_ETF_BPS = 3000;
export const DEFAULT_SAVER_ALLOWANCE_CENTS = 100_000;
export const MAX_SAVER_ALLOWANCE_CENTS = 200_000;
export const ALLOWED_CHURCH_TAX_BPS = [0, 800, 900] as const;
export const DEFAULT_ESTIMATED_HORIZON_MONTHS = 120;

const GROWTH_SCALE = 10n ** 12n;
const BPS_DENOMINATOR = 10_000;

// ---------------------------------------------------------------------------
// Bausteine: Wachstum
// ---------------------------------------------------------------------------

/**
 * Monthly growth factor (scaled by 10^12) equivalent to an effective annual
 * return: floor(12th root of (1 + bps/10000) * S). Pure BigInt binary search.
 */
export function computeMonthlyGrowthFactor(annualReturnBps: number): bigint {
  const bps = assertSafeInteger(annualReturnBps, "annualReturnBps");
  if (bps < MIN_ETF_RETURN_BPS || bps > MAX_ETF_RETURN_BPS) {
    throw new RangeError(
      `annualReturnBps must be between ${MIN_ETF_RETURN_BPS} and ${MAX_ETF_RETURN_BPS}, received: ${bps}`,
    );
  }

  const ratioNumerator = BigInt(BPS_DENOMINATOR + bps);
  const target = ratioNumerator * GROWTH_SCALE ** 12n;
  const denominator = BigInt(BPS_DENOMINATOR);

  let low = GROWTH_SCALE / 2n;
  let high = GROWTH_SCALE * 2n;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (mid ** 12n * denominator <= target) {
      low = mid;
    } else {
      high = mid - 1n;
    }
  }
  return low;
}

/**
 * Applies a monthly growth factor to a non-negative cent value (BigInt half-up).
 */
export function applyMonthlyGrowth(valueCents: number, factor: bigint): number {
  const safeValue = assertNonNegativeInteger(valueCents, "valueCents");
  if (factor <= 0n) {
    throw new RangeError("factor must be positive");
  }
  const grown = roundHalfUpBigInt(BigInt(safeValue) * factor, GROWTH_SCALE);
  return assertSafeInteger(Number(grown), "grownValueCents");
}

// ---------------------------------------------------------------------------
// Bausteine: Steuer
// ---------------------------------------------------------------------------

export interface EtfTaxBreakdown {
  gainCents: number;
  taxablePartCents: number;
  allowanceUsedCents: number;
  taxableCents: number;
  capitalGainsTaxCents: number;
  soliCents: number;
  churchTaxCents: number;
  totalTaxCents: number;
  netValueCents: number;
}

export interface EtfLiquidationTaxInput {
  valueCents: number;
  costBasisCents: number;
  saverAllowanceCents: number;
  churchTaxBps: number;
  partialExemptionBps?: number;
}

function mulDivHalfUp(a: number, b: number, c: number): number {
  return Number(roundHalfUpBigInt(BigInt(a) * BigInt(b), BigInt(c)));
}

/**
 * Taxes a fictitious full liquidation (German KapESt incl. Soli and optional
 * KiSt reduction per § 32d EStG). No loss offsetting: losses yield zero tax.
 */
export function calculateEtfLiquidationTax(
  input: EtfLiquidationTaxInput,
): EtfTaxBreakdown {
  const value = assertNonNegativeInteger(input.valueCents, "valueCents");
  const basis = assertNonNegativeInteger(input.costBasisCents, "costBasisCents");
  const allowance = assertNonNegativeInteger(
    input.saverAllowanceCents,
    "saverAllowanceCents",
  );
  if (allowance > MAX_SAVER_ALLOWANCE_CENTS) {
    throw new RangeError(
      `saverAllowanceCents must be <= ${MAX_SAVER_ALLOWANCE_CENTS}, received: ${allowance}`,
    );
  }
  const kistBps = assertSafeInteger(input.churchTaxBps, "churchTaxBps");
  if (!(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(kistBps)) {
    throw new RangeError(
      `churchTaxBps must be one of ${ALLOWED_CHURCH_TAX_BPS.join(", ")}, received: ${kistBps}`,
    );
  }
  const exemptionBps = assertNonNegativeInteger(
    input.partialExemptionBps ?? PARTIAL_EXEMPTION_EQUITY_ETF_BPS,
    "partialExemptionBps",
  );
  if (exemptionBps > BPS_DENOMINATOR) {
    throw new RangeError(
      `partialExemptionBps must be <= ${BPS_DENOMINATOR}, received: ${exemptionBps}`,
    );
  }

  const gainCents = Math.max(0, value - basis);
  const taxablePartCents = mulDivHalfUp(
    gainCents,
    BPS_DENOMINATOR - exemptionBps,
    BPS_DENOMINATOR,
  );
  const allowanceUsedCents = Math.min(allowance, taxablePartCents);
  const taxableCents = taxablePartCents - allowanceUsedCents;

  const capitalGainsTaxCents = mulDivHalfUp(
    taxableCents,
    BPS_DENOMINATOR,
    4 * BPS_DENOMINATOR + kistBps,
  );
  const soliCents = mulDivHalfUp(
    capitalGainsTaxCents,
    SOLI_BPS,
    BPS_DENOMINATOR,
  );
  const churchTaxCents = mulDivHalfUp(
    capitalGainsTaxCents,
    kistBps,
    BPS_DENOMINATOR,
  );
  const totalTaxCents = capitalGainsTaxCents + soliCents + churchTaxCents;

  return {
    gainCents,
    taxablePartCents,
    allowanceUsedCents,
    taxableCents,
    capitalGainsTaxCents,
    soliCents,
    churchTaxCents,
    totalTaxCents,
    netValueCents: value - totalTaxCents,
  };
}
