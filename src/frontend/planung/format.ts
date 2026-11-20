import { formatDateDE, formatMonthDE } from "@/domain/core/date-format";

/** `YYYY-MM-DD` → `TT.MM.JJJJ`. */
export function formatIsoDateDE(iso: string): string {
  return formatDateDE(iso);
}

/** `YYYY-MM` → `MM.JJJJ`. */
export function formatYearMonthDE(ym: string): string {
  return formatMonthDE(ym);
}
