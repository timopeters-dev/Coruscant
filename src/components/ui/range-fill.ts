import type { CSSProperties } from "react";

/**
 * Füllstand eines nativen Sliders als CSS-Variable `--fill` (siehe globals.css):
 * Anteil von `value` zwischen `min` und `max`, auf 0–100 % begrenzt.
 */
export function rangeFillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min;
  const ratio = span > 0 && Number.isFinite(value) ? (value - min) / span : 0;
  const percent = Math.min(100, Math.max(0, ratio * 100));
  return { "--fill": `${percent}%` } as CSSProperties;
}
