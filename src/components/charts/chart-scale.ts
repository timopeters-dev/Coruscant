import { addMonthsToYearMonth, parseYearMonth } from "@/lib/domain/date";
import { assertSafeInteger } from "@/lib/domain/money";

const deIntegerFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

export const UNICODE_MINUS = "−";

/**
 * Linear scale mapping domain [d0, d1] to range [r0, r1].
 * Zero-span domains are widened symmetrically by ±1.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  let [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) {
    d0 -= 1;
    d1 += 1;
  }
  const span = d1 - d0;
  const rangeSpan = r1 - r0;
  return (value: number) => r0 + ((value - d0) / span) * rangeSpan;
}

/**
 * Computes nice integer-cent axis ticks using 1/2/2.5/5 × 10^n Euro steps.
 * Guarantees at least 2 ticks, ascending order, and includes 0 when in range.
 */
export function niceCentTicks(
  minCents: number,
  maxCents: number,
  maxTicks = 5,
): number[] {
  const safeMin = assertSafeInteger(minCents, "minCents");
  const safeMax = assertSafeInteger(maxCents, "maxCents");
  const targetMaxTicks = Math.max(2, Math.trunc(maxTicks));

  const lo = Math.min(safeMin, safeMax);
  const hi = Math.max(safeMin, safeMax);

  if (lo === hi) {
    if (lo === 0) {
      return [0, 10_000];
    }
    const step = pickStep(Math.abs(lo), targetMaxTicks);
    const base = Math.floor(lo / step) * step;
    const top = base === lo ? base + step : Math.ceil(hi / step) * step;
    return base < 0 && top > 0
      ? buildTickArray(base, top, step)
      : [base, top];
  }

  const span = hi - lo;
  let power = Math.max(0, Math.floor(Math.log10(span / 100)) - 1);
  const multipliers = [1, 2, 2.5, 5] as const;

  for (let guard = 0; guard < 40; guard += 1) {
    const base = 100 * 10 ** power;
    for (const m of multipliers) {
      const step = Math.round(base * m);
      if (step <= 0) continue;
      const kMin = Math.floor(lo / step);
      const kMax = Math.ceil(hi / step);
      const count = kMax - kMin + 1;
      if (count <= targetMaxTicks) {
        return buildTickArray(kMin * step, kMax * step, step);
      }
    }
    power += 1;
  }

  return [lo, hi];
}

function pickStep(span: number, maxTicks: number): number {
  let power = Math.max(0, Math.floor(Math.log10(Math.max(100, span) / 100)) - 1);
  const multipliers = [1, 2, 2.5, 5] as const;
  for (let guard = 0; guard < 40; guard += 1) {
    const base = 100 * 10 ** power;
    for (const m of multipliers) {
      const step = Math.round(base * m);
      if (step > 0 && Math.ceil(span / step) + 1 <= maxTicks) {
        return step;
      }
    }
    power += 1;
  }
  return Math.max(100, span);
}

function buildTickArray(start: number, end: number, step: number): number[] {
  const ticks: number[] = [];
  for (let v = start; v <= end; v += step) {
    ticks.push(v === 0 ? 0 : v);
  }
  if (ticks.length < 2) {
    ticks.push(start + step);
  }
  return ticks;
}

function formatScaledUnit(
  whole: number,
  fracTwoDigits: number,
  unit: string,
  sign: string,
): string {
  if (fracTwoDigits === 0) {
    return `${sign}${deIntegerFormatter.format(whole)} ${unit}`;
  }
  const fracStr =
    fracTwoDigits % 10 === 0
      ? String(fracTwoDigits / 10)
      : String(fracTwoDigits).padStart(2, "0");
  return `${sign}${deIntegerFormatter.format(whole)},${fracStr} ${unit}`;
}

/**
 * Formats an integer cent value for compact chart axes using pure integer arithmetic.
 * Examples: 0 -> "0 €", 80000 -> "800 €", 5000000 -> "50 Tsd. €", 125000000 -> "1,25 Mio. €"
 */
export function formatAxisCentsDE(cents: number): string {
  const safe = assertSafeInteger(cents, "cents");
  const absCents = BigInt(Math.abs(safe));
  const absEuros = (absCents * 2n + 100n) / 200n;

  if (absEuros === 0n) {
    return "0 €";
  }

  const sign = safe < 0 ? UNICODE_MINUS : "";

  if (absEuros >= 1_000_000n) {
    // Round to 2 decimal places of Mio. (10_000 € increments)
    const hundredths = Number((absEuros * 2n + 10_000n) / 20_000n);
    const whole = Math.trunc(hundredths / 100);
    const frac = hundredths % 100;
    return formatScaledUnit(whole, frac, "Mio. €", sign);
  }

  if (absEuros >= 10_000n) {
    // Round to 1 decimal place of Tsd. (100 € increments)
    const tenths = Number((absEuros * 2n + 100n) / 200n);
    const whole = Math.trunc(tenths / 10);
    const frac = tenths % 10;
    return formatScaledUnit(whole, frac * 10, "Tsd. €", sign);
  }

  return `${sign}${deIntegerFormatter.format(Number(absEuros))} €`;
}

/**
 * Formats an integer cent amount rounded half-up to whole Euros.
 * Uses Unicode minus for negative values and omits sign on 0 €.
 */
export function formatWholeEuroDE(
  cents: number,
  options?: { showPlusSign?: boolean },
): string {
  const safe = assertSafeInteger(cents, "cents");
  const abs = BigInt(Math.abs(safe));
  const roundedEuros = Number((abs * 2n + 100n) / 200n);

  let sign = "";
  if (roundedEuros > 0) {
    if (safe < 0) {
      sign = UNICODE_MINUS;
    } else if (options?.showPlusSign) {
      sign = "+";
    }
  }

  return `${sign}${deIntegerFormatter.format(roundedEuros)} €`;
}

export interface ChartTick {
  x: number;
  label: string;
}

/**
 * Picks year ticks (Januarys) plus start (0) and end (horizonMonths) for a monthly axis.
 */
export function pickYearTicks(
  startMonth: string,
  horizonMonths: number,
  maxTicks = 8,
): ChartTick[] {
  const safeHorizon = assertSafeInteger(horizonMonths, "horizonMonths");
  if (safeHorizon <= 0) {
    return [{ x: 0, label: "heute" }];
  }

  const parsedStart = parseYearMonth(startMonth, "startMonth");
  const januaries: ChartTick[] = [];

  for (let t = 1; t <= safeHorizon; t += 1) {
    const ym = addMonthsToYearMonth(startMonth, t - 1);
    const parts = parseYearMonth(ym, "ym");
    if (parts.month === 1) {
      januaries.push({ x: t, label: String(parts.year) });
    }
  }

  const availableForYears = Math.max(1, maxTicks - 2);
  let stepYears = 1;
  if (januaries.length > availableForYears) {
    stepYears = Math.ceil(januaries.length / availableForYears);
  }

  const filteredJanuaries = januaries.filter((_, idx) => idx % stepYears === 0);

  const ticks: ChartTick[] = [{ x: 0, label: "heute" }];
  const minGap = Math.max(2, Math.round(safeHorizon / Math.max(4, maxTicks * 2)));

  for (const j of filteredJanuaries) {
    const prev = ticks[ticks.length - 1]!;
    if (j.x - prev.x >= minGap && safeHorizon - j.x >= minGap) {
      ticks.push(j);
    }
  }

  const endYm = addMonthsToYearMonth(startMonth, safeHorizon - 1);
  const endParts = parseYearMonth(endYm, "endYm");
  const endLabel =
    endParts.year === parsedStart.year && safeHorizon < 12
      ? `${String(endParts.month).padStart(2, "0")}/${endParts.year}`
      : `${String(endParts.month).padStart(2, "0")}/${endParts.year}`;

  if (ticks[ticks.length - 1]!.x !== safeHorizon) {
    ticks.push({ x: safeHorizon, label: endLabel });
  }

  return ticks;
}

/**
 * Binary search for the index in sorted `xs` closest to `x`.
 * Returns -1 for an empty array; ties resolve to the left index.
 */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  if (x <= xs[0]!) return 0;
  const last = xs.length - 1;
  if (x >= xs[last]!) return last;

  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return x - xs[lo]! <= xs[hi]! - x ? lo : hi;
}
