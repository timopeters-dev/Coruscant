"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/lib/domain/money";
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
}: SliderFieldProps) {
  const format =
    kind === "euro"
      ? centsToEuroInputString
      : kind === "percent"
        ? bpsToPercentInputString
        : (v: number) => String(v);
  const parse =
    kind === "euro"
      ? parseEuroInputToCents
      : kind === "percent"
        ? parsePercentInputToBps
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
      <label htmlFor={id} className="text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => {
            setDraft(null);
            onChange(Number(e.target.value));
          }}
          className="h-2 min-w-0 flex-1 accent-[var(--accent)]"
        />
        <div className="relative w-32 shrink-0">
          <Input
            aria-label={`${label} (Eingabe)`}
            inputMode={
              kind === "years" || kind === "months" ? "numeric" : "decimal"
            }
            value={text}
            hasError={invalid}
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
      {hint ? (
        <p className="text-xs text-[var(--text-secondary)]">{hint}</p>
      ) : null}
    </div>
  );
}
