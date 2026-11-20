/**
 * Einheitliche Datumsanzeige für die gesamte Oberfläche.
 *
 * - Tagesgenaue Werte:  `TT.MM.JJJJ`  (z. B. 05.03.2027)
 * - Monatsgenaue Werte: `MM.JJJJ`     (z. B. 03.2027) – ohne erfundenen Tag
 * - Zeitpunkte:         `TT.MM.JJJJ, HH:MM` (Europe/Berlin)
 *
 * Gespeichert wird weiterhin ISO (`YYYY-MM-DD` / `YYYY-MM`); diese Funktionen
 * sind reine Darstellung. Unlesbare Eingaben kommen unverändert zurück, damit
 * die Anzeige nie hart abbricht.
 */

const ISO_DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_MONTH_PREFIX = /^(\d{4})-(\d{2})(?:$|-)/;

/** `YYYY-MM-DD` (auch Zeitstempel mit diesem Präfix) → `TT.MM.JJJJ`. */
export function formatDateDE(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = ISO_DAY_PREFIX.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** `YYYY-MM` oder `YYYY-MM-DD` → `MM.JJJJ`. */
export function formatMonthDE(value: string | null | undefined): string {
  if (!value) return "";
  const match = ISO_MONTH_PREFIX.exec(value);
  if (!match) return value;
  return `${match[2]}.${match[1]}`;
}

/** Monat (1–12) und Jahr → `MM.JJJJ`. */
export function formatMonthPartsDE(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}.${String(year).padStart(4, "0")}`;
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("de-DE", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Zeitstempel → `TT.MM.JJJJ, HH:MM` in der angegebenen Zeitzone. */
export function formatDateTimeDE(
  timestamp: string | Date,
  timeZone = "Europe/Berlin",
): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) {
    return typeof timestamp === "string" ? timestamp : "";
  }
  const parts = Object.fromEntries(
    dateTimeFormatter(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}
