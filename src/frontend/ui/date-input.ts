/**
 * Reine Hilfen für Datums-/Monatsfelder. Werte bleiben ISO-Strings
 * (`YYYY-MM-DD` bzw. `YYYY-MM`); die Anzeige ist deutsch (`TT.MM.JJJJ`).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export const MONTH_NAMES_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

export const MONTH_SHORT_DE = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** ISO-Datum → lokales `Date` (Mitternacht) oder `undefined`. */
export function isoToDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = ISO_DATE.exec(iso);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYmd(year, month, day)) return undefined;
  return new Date(year, month - 1, day);
}

/** Lokales `Date` → ISO-Datum. */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `YYYY-MM-DD` → `TT.MM.JJJJ` (ungültig → leer). */
export function formatIsoDateInput(iso: string | null | undefined): string {
  const date = isoToDate(iso);
  if (!date) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/**
 * Freitext → ISO-Datum. Akzeptiert `T.M.JJJJ`, `TT.MM.JJ` (→ 20JJ), `TTMMJJJJ`
 * und `YYYY-MM-DD`. Leer → `""`, ungültig → `null`.
 */
export function parseDateInput(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";

  const iso = ISO_DATE.exec(text);
  if (iso) {
    return isValidYmd(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? text : null;
  }

  let day: number;
  let month: number;
  let year: number;
  const dotted = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (dotted) {
    day = Number(dotted[1]);
    month = Number(dotted[2]);
    year = dotted[3]!.length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
  } else if (compact) {
    day = Number(compact[1]);
    month = Number(compact[2]);
    year = Number(compact[3]);
  } else {
    return null;
  }
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Liegt `iso` innerhalb von [min, max] (jeweils optional, ISO-Vergleich)? */
export function isWithinIsoBounds(
  iso: string,
  min?: string | null,
  max?: string | null,
): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

/** `YYYY-MM` → `{ year, month }` (Monat 1–12) oder `null`. */
export function parseIsoMonth(
  value: string | null | undefined,
): { year: number; month: number } | null {
  if (!value) return null;
  const m = ISO_MONTH.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function toIsoMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** `YYYY-MM` → „März 2026“ (ungültig → leer). */
export function formatIsoMonthLabel(value: string | null | undefined): string {
  const parsed = parseIsoMonth(value);
  if (!parsed) return "";
  return `${MONTH_NAMES_DE[parsed.month - 1]} ${parsed.year}`;
}
