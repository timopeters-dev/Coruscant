import { assertSafeInteger } from "./money";

export interface IsoDateParts {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Returns the number of days in a given calendar month (1-12).
 */
export function daysInMonth(year: number, month: number): number {
  const safeYear = assertSafeInteger(year, "year");
  const safeMonth = assertSafeInteger(month, "month");
  if (safeMonth < 1 || safeMonth > 12) {
    throw new RangeError(`month must be between 1 and 12, received: ${month}`);
  }

  switch (safeMonth) {
    case 2: {
      const isLeapYear =
        (safeYear % 4 === 0 && safeYear % 100 !== 0) || safeYear % 400 === 0;
      return isLeapYear ? 29 : 28;
    }
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Parses and strictly validates a YYYY-MM-DD calendar date string.
 */
export function parseIsoDate(
  value: string,
  fieldName = "date",
): IsoDateParts {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(
      `${fieldName} must be in YYYY-MM-DD format, received: "${value}"`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new RangeError(
      `${fieldName} has invalid month (${month}) in "${value}"`,
    );
  }

  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new RangeError(
      `${fieldName} has invalid day (${day}) for ${year}-${String(month).padStart(2, "0")} in "${value}"`,
    );
  }

  return { year, month, day };
}

/**
 * Counts completed calendar months between two YYYY-MM-DD dates using
 * end-of-month clamping (e.g. 2026-01-31 -> 2026-02-28 counts as 1 month).
 * Returns 0 when toIsoDate <= fromIsoDate.
 */
export function countCompletedMonths(
  fromIsoDate: string,
  toIsoDate: string,
): number {
  const from = parseIsoDate(fromIsoDate, "fromIsoDate");
  const to = parseIsoDate(toIsoDate, "toIsoDate");

  if (
    to.year < from.year ||
    (to.year === from.year && to.month < from.month) ||
    (to.year === from.year && to.month === from.month && to.day <= from.day)
  ) {
    return 0;
  }

  let months = (to.year - from.year) * 12 + (to.month - from.month);
  const clampedTargetDay = Math.min(from.day, daysInMonth(to.year, to.month));
  if (to.day < clampedTargetDay) {
    months -= 1;
  }

  return Math.max(0, months);
}

/**
 * Returns the exact signed calendar day difference (toIsoDate - fromIsoDate).
 */
export function diffCalendarDays(
  fromIsoDate: string,
  toIsoDate: string,
): number {
  const from = parseIsoDate(fromIsoDate, "fromIsoDate");
  const to = parseIsoDate(toIsoDate, "toIsoDate");

  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.trunc((toUtc - fromUtc) / MS_PER_DAY);
}

/**
 * Returns the calendar date (YYYY-MM-DD) for the given instant in the target time zone.
 */
export function getTodayIsoDate(
  now: Date = new Date(),
  timeZone = "Europe/Berlin",
): string {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  parseIsoDate(formatted, "todayIsoDate");
  return formatted;
}

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export interface YearMonthParts {
  year: number;
  month: number;
}

/**
 * Parses and strictly validates a YYYY-MM string.
 */
export function parseYearMonth(
  value: string,
  fieldName = "yearMonth",
): YearMonthParts {
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(
      `${fieldName} must be in YYYY-MM format, received: "${value}"`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new RangeError(
      `${fieldName} has invalid month (${month}) in "${value}"`,
    );
  }
  return { year, month };
}

function formatYearMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * Adds a non-negative whole number of months to a YYYY-MM string.
 */
export function addMonthsToYearMonth(ym: string, months: number): string {
  const { year, month } = parseYearMonth(ym, "yearMonth");
  const safeMonths = assertSafeInteger(months, "months");
  if (safeMonths < 0) {
    throw new RangeError(
      `months must be a non-negative integer, received: ${months}`,
    );
  }
  const zeroBased = year * 12 + (month - 1) + safeMonths;
  return formatYearMonth(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/**
 * Extracts the YYYY-MM prefix of a validated YYYY-MM-DD date.
 */
export function toYearMonth(isoDate: string): string {
  const { year, month } = parseIsoDate(isoDate, "isoDate");
  return formatYearMonth(year, month);
}

/**
 * Adds a non-negative whole number of months to a YYYY-MM-DD date with
 * end-of-month clamping (2026-01-31 + 1 -> 2026-02-28).
 */
export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const { year, month, day } = parseIsoDate(isoDate, "isoDate");
  const safeMonths = assertSafeInteger(months, "months");
  if (safeMonths < 0) {
    throw new RangeError(
      `months must be a non-negative integer, received: ${months}`,
    );
  }
  const zeroBased = year * 12 + (month - 1) + safeMonths;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${formatYearMonth(targetYear, targetMonth)}-${String(targetDay).padStart(2, "0")}`;
}

/**
 * Adds a non-negative whole number of calendar days to a YYYY-MM-DD date.
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDate(isoDate, "isoDate");
  const safeDays = assertSafeInteger(days, "days");
  if (safeDays < 0) {
    throw new RangeError(
      `days must be a non-negative integer, received: ${days}`,
    );
  }
  const utc = new Date(Date.UTC(year, month - 1, day + safeDays));
  const targetYear = utc.getUTCFullYear();
  const targetMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const targetDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${targetYear}-${targetMonth}-${targetDay}`;
}
