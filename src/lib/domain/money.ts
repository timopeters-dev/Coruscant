const deIntegerFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

/**
 * Ensures a numeric value is a safe integer (no floats, NaN, or Infinity).
 * Normalizes -0 to 0.
 */
export function assertSafeInteger(
  value: number,
  fieldName = "amount",
): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${fieldName} must be a safe integer, received: ${String(value)}`,
    );
  }
  return value === 0 ? 0 : value;
}

/**
 * Ensures a numeric value is a non-negative safe integer (>= 0).
 * Normalizes -0 to 0.
 */
export function assertNonNegativeInteger(
  value: number,
  fieldName = "amount",
): number {
  const normalized = assertSafeInteger(value, fieldName);
  if (normalized < 0) {
    throw new RangeError(
      `${fieldName} must be a non-negative integer, received: ${String(value)}`,
    );
  }
  return normalized;
}

/**
 * Pure BigInt half-up division for non-negative numerators and positive denominators.
 */
export function roundHalfUpBigInt(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (numerator < 0n) {
    throw new RangeError("numerator must be non-negative");
  }
  if (denominator <= 0n) {
    throw new RangeError("denominator must be positive");
  }
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Signed half-up BigInt division for a signed numerator and positive denominator.
 */
export function divRoundHalfUpSigned(
  numerator: bigint,
  denominator: bigint,
): number {
  if (denominator <= 0n) {
    throw new RangeError("denominator must be positive");
  }
  if (numerator === 0n) {
    return 0;
  }
  const sign = numerator < 0n ? -1 : 1;
  const absNum = numerator < 0n ? -numerator : numerator;
  const rounded = roundHalfUpBigInt(absNum, denominator);
  const value = sign * Number(rounded);
  return value === 0 ? 0 : assertSafeInteger(value, "divRoundHalfUpSigned");
}

/**
 * Formats an integer cent amount in German locale without float arithmetic.
 * Example: 123456 -> "1.234,56 €"
 */
export function formatCentsDE(
  amountCents: number,
  options?: { showPlusSign?: boolean },
): string {
  const normalized = assertSafeInteger(amountCents, "amountCents");
  const abs = Math.abs(normalized);
  const euros = Math.trunc(abs / 100);
  const cents = abs % 100;

  let sign = "";
  if (normalized < 0) {
    sign = "-";
  } else if (options?.showPlusSign && normalized > 0) {
    sign = "+";
  }

  const euroPart = deIntegerFormatter.format(euros);
  const centPart = String(cents).padStart(2, "0");
  return `${sign}${euroPart},${centPart} €`;
}

/**
 * Formats an integer basis-point rate in German locale without float arithmetic.
 * Example: 350 -> "3,50 %"
 */
export function formatBpsDE(rateBps: number): string {
  const normalized = assertSafeInteger(rateBps, "rateBps");
  const abs = Math.abs(normalized);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;

  const sign = normalized < 0 ? "-" : "";
  const wholePart = deIntegerFormatter.format(whole);
  const fracPart = String(frac).padStart(2, "0");
  return `${sign}${wholePart},${fracPart} %`;
}

/**
 * Parses a Euro input string (e.g. "1.234,56", "1234.56", "-50,5", "100")
 * into integer cents using pure string parsing (no float multiplication).
 * Returns null for invalid inputs or more than 2 decimal places.
 */
export function parseEuroInputToCents(input: string): number | null {
  let trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.endsWith("€")) {
    trimmed = trimmed.slice(0, -1).trim();
  }
  if (trimmed.length === 0) {
    return null;
  }

  let sign = 1;
  if (trimmed.startsWith("-")) {
    sign = -1;
    trimmed = trimmed.slice(1).trim();
  } else if (trimmed.startsWith("+")) {
    trimmed = trimmed.slice(1).trim();
  }

  if (trimmed.length === 0 || !/^[0-9.,]+$/.test(trimmed)) {
    return null;
  }

  const commaCount = (trimmed.match(/,/g) ?? []).length;
  const dotCount = (trimmed.match(/\./g) ?? []).length;

  let integerStr = "";
  let fractionStr = "";

  if (commaCount > 1) {
    return null;
  }

  if (commaCount === 1) {
    const parts = trimmed.split(",");
    integerStr = parts[0] ?? "";
    fractionStr = parts[1] ?? "";
    if (fractionStr.includes(".")) {
      return null;
    }
    if (dotCount > 0 && !/^\d{1,3}(\.\d{3})*$/.test(integerStr)) {
      return null;
    }
    integerStr = integerStr.replaceAll(".", "");
  } else if (dotCount === 1) {
    const parts = trimmed.split(".");
    const left = parts[0] ?? "";
    const right = parts[1] ?? "";
    // Distinguish decimal dot ("1234.56", "12.5") from German thousands separator ("1.000")
    if (right.length === 3 && left.length >= 1 && left.length <= 3) {
      integerStr = `${left}${right}`;
      fractionStr = "";
    } else {
      integerStr = left;
      fractionStr = right;
    }
  } else if (dotCount > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
      return null;
    }
    integerStr = trimmed.replaceAll(".", "");
  } else {
    integerStr = trimmed;
  }

  if (!/^\d+$/.test(integerStr)) {
    return null;
  }
  if (fractionStr.length > 0 && !/^\d+$/.test(fractionStr)) {
    return null;
  }
  if (fractionStr.length > 2) {
    return null;
  }

  const paddedFraction = fractionStr.padEnd(2, "0");
  const euros = Number(integerStr);
  const cents = Number(paddedFraction);

  if (!Number.isSafeInteger(euros) || !Number.isSafeInteger(cents)) {
    return null;
  }

  const total = sign * (euros * 100 + cents);
  if (!Number.isSafeInteger(total)) {
    return null;
  }

  return total === 0 ? 0 : total;
}

/**
 * Parses a non-negative percentage string (e.g. "3,5", "3.50 %", "0", "12")
 * into integer basis points using pure string parsing (no float multiplication).
 * Returns null for negative values, invalid inputs, or >2 decimal places.
 */
export function parsePercentInputToBps(input: string): number | null {
  let trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.endsWith("%")) {
    trimmed = trimmed.slice(0, -1).trim();
  }
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("-")) {
    return null;
  }
  if (trimmed.startsWith("+")) {
    trimmed = trimmed.slice(1).trim();
  }

  if (trimmed.length === 0 || !/^[0-9.,]+$/.test(trimmed)) {
    return null;
  }

  const commaCount = (trimmed.match(/,/g) ?? []).length;
  const dotCount = (trimmed.match(/\./g) ?? []).length;

  if (commaCount + dotCount > 1) {
    return null;
  }

  const separator = commaCount === 1 ? "," : dotCount === 1 ? "." : null;
  let wholeStr = trimmed;
  let fracStr = "";

  if (separator !== null) {
    const parts = trimmed.split(separator);
    wholeStr = parts[0] ?? "";
    fracStr = parts[1] ?? "";
  }

  if (!/^\d+$/.test(wholeStr)) {
    return null;
  }
  if (fracStr.length > 0 && !/^\d+$/.test(fracStr)) {
    return null;
  }
  if (fracStr.length > 2) {
    return null;
  }

  const whole = Number(wholeStr);
  const frac = Number(fracStr.padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) {
    return null;
  }

  const bps = whole * 100 + frac;
  if (!Number.isSafeInteger(bps)) {
    return null;
  }

  return bps === 0 ? 0 : bps;
}

/**
 * Converts integer cents into an editable German decimal string without currency suffix
 * (e.g. 48000000 -> "480000,00"), round-trip compatible with parseEuroInputToCents.
 */
export function centsToEuroInputString(amountCents: number): string {
  const normalized = assertSafeInteger(amountCents, "amountCents");
  const abs = Math.abs(normalized);
  const euros = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const sign = normalized < 0 ? "-" : "";
  return `${sign}${euros},${cents}`;
}

/**
 * Converts integer basis points into an editable German percentage string without "%" suffix
 * (e.g. 350 -> "3,50"), round-trip compatible with parsePercentInputToBps.
 */
export function bpsToPercentInputString(rateBps: number): string {
  const normalized = assertNonNegativeInteger(rateBps, "rateBps");
  const whole = Math.trunc(normalized / 100);
  const frac = String(normalized % 100).padStart(2, "0");
  return `${whole},${frac}`;
}

/**
 * Verteilt `total` ganzzahlig proportional zu `weights` (Largest-Remainder, BigInt).
 * - Summe des Ergebnisses ist exakt `total`, sobald die Gewichtssumme > 0 ist.
 * - Gewichtssumme 0 → alle Anteile 0.
 * - Gleicher Rest → der kleinere Index gewinnt (deterministisch).
 */
export function allocateProportionally(
  total: number,
  weights: readonly number[],
): number[] {
  assertNonNegativeInteger(total, "total");
  weights.forEach((w, i) => assertNonNegativeInteger(w, `weights[${i}]`));

  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (weightSum === 0n) {
    return weights.map(() => 0);
  }

  const totalBig = BigInt(total);
  const shares = weights.map((w) => (BigInt(w) * totalBig) / weightSum);
  const remainders = weights.map((w, index) => ({
    index,
    remainder: (BigInt(w) * totalBig) % weightSum,
  }));

  let leftover = totalBig - shares.reduce((acc, s) => acc + s, 0n);
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const { index } of remainders) {
    if (leftover <= 0n) break;
    shares[index] = shares[index]! + 1n;
    leftover -= 1n;
  }

  return shares.map((s) => Number(s));
}
