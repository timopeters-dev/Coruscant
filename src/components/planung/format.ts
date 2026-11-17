export function formatIsoDateDE(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function formatYearMonthDE(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}
