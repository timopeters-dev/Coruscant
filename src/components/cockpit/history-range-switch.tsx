"use client";

import type { HistoryRangeId } from "@/lib/domain/balance-history";

interface HistoryRangeSwitchProps {
  value: HistoryRangeId;
  onChange: (next: HistoryRangeId) => void;
}

export const HISTORY_RANGE_OPTIONS: readonly {
  id: HistoryRangeId;
  label: string;
}[] = [
  { id: "3m", label: "3 Monate" },
  { id: "6m", label: "6 Monate" },
  { id: "12m", label: "12 Monate" },
  { id: "all", label: "Alles" },
] as const;

export function HistoryRangeSwitch({
  value,
  onChange,
}: HistoryRangeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Zeitraum"
      className="inline-flex flex-wrap items-center rounded-lg border border-[var(--border-sub)] bg-[var(--surface-elevated)] p-0.5"
    >
      {HISTORY_RANGE_OPTIONS.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
