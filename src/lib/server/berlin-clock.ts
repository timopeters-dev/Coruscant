export const SCHEDULER_TIMEZONE = "Europe/Berlin";

export interface BerlinClockSnapshot {
  dateKey: string;
  hour: number;
  minute: number;
  slotKey: string;
}

const berlinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function getBerlinClockSnapshot(
  now: Date = new Date(),
): BerlinClockSnapshot {
  const parts = berlinFormatter.formatToParts(now);
  const byType = new Map<string, string>();
  for (const part of parts) {
    byType.set(part.type, part.value);
  }
  const year = byType.get("year") ?? "1970";
  const month = byType.get("month") ?? "01";
  const day = byType.get("day") ?? "01";
  const hourStr = byType.get("hour") ?? "00";
  const minuteStr = byType.get("minute") ?? "00";

  const dateKey = `${year}-${month}-${day}`;
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const slotKey = `${dateKey} ${hourStr}:${minuteStr}`;

  return {
    dateKey,
    hour,
    minute,
    slotKey,
  };
}

export function toBerlinDateKey(isoTimestamp: string): string {
  return getBerlinClockSnapshot(new Date(isoTimestamp)).dateKey;
}
