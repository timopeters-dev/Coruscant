"use client";

import { rangeFillStyle } from "@/frontend/ui/range-fill";
import * as React from "react";
import { InfoTip } from "@/frontend/ui/info-tip";
import { Input } from "@/frontend/ui/input";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/domain/core/money";
import { parseIntegerInput } from "./purchase-calculator-state";

interface SliderFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  kind: "euro" | "percent" | "years" | "months";
  hint?: string;
  disabled?: boolean;
  /** Nur für `kind="percent"`: erlaubt negative Werte (z. B. Wertsteigerung). */
  allowNegative?: boolean;
  /** Feldfehler (rot, unter dem Feld). */
  error?: string;
  /** Erklärtext; mit Wert steht ein Info-Symbol neben dem Label. */
  info?: string;
}

/**
 * Native range slider plus text input, both operating on integer cents/bps.
 * Text input accepts values outside the slider range (clamped by parent rules).
 */
export function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  kind,
  hint,
  disabled = false,
  allowNegative = false,
  error,
  info,
}: SliderFieldProps) {
  // Ein Regler mit negativem Minimum muss negative Werte auch darstellen können –
  // sonst wirft die Formatierung beim Ziehen unter 0 einen RangeError.
  const negativeAllowed = allowNegative || min < 0;
  const format =
    kind === "euro"
      ? centsToEuroInputString
      : kind === "percent"
        ? (v: number) =>
            bpsToPercentInputString(v, { allowNegative: negativeAllowed })
        : (v: number) => String(v);
  const parse =
    kind === "euro"
      ? parseEuroInputToCents
      : kind === "percent"
        ? (raw: string) =>
            parsePercentInputToBps(raw, { allowNegative: negativeAllowed })
        : parseIntegerInput;
  // Keep the user's draft while typing (even if invalid or still incomplete,
  // e.g. "-"). Fall back to the formatted value once the value was changed
  // from outside (slider) and no longer matches what the draft parses to.
  const [draft, setDraft] = React.useState<string | null>(null);
  const parsedDraft = draft === null ? null : parse(draft);
  const draftIsStale = parsedDraft !== null && parsedDraft !== value;
  const text = draft !== null && !draftIsStale ? draft : format(value);
  const invalid = draft !== null && parsedDraft === null;

  return (
    <div className="flex flex-col gap-1.5">
      {info ? (
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-secondary)]">
            {label}
          </label>
          <InfoTip label={label} text={info} id={`${id}-info`} />
        </div>
      ) : (
        <label htmlFor={id} className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
        </label>
      )}
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={Math.min(max, Math.max(min, value))}
          style={rangeFillStyle(value, min, max)}
          onChange={(e) => {
            setDraft(null);
            onChange(Number(e.target.value));
          }}
          className="min-w-0 flex-1 disabled:opacity-50"
        />
        <div className="relative w-32 shrink-0">
          <Input
            aria-label={`${label} (Eingabe)`}
            disabled={disabled}
            inputMode={
              kind === "years" || kind === "months" ? "numeric" : "decimal"
            }
            value={text}
            hasError={invalid || Boolean(error)}
            className={
              kind === "months"
                ? "pr-11 text-right tabular-nums"
                : "pr-7 text-right tabular-nums"
            }
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value);
              const parsed = parse(e.target.value);
              if (parsed !== null) {
                onChange(parsed);
              }
            }}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)]">
            {kind === "euro"
              ? "€"
              : kind === "percent"
                ? "%"
                : kind === "months"
                  ? "Mon."
                  : "J."}
          </span>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="text-xs text-[var(--text-secondary)]">{hint}</p>
      ) : null}
    </div>
  );
}
