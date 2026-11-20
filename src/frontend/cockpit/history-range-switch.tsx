"use client";

import type { HistoryRangeId } from "@/domain/cockpit/balance-history";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/frontend/ui/segmented";

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
    <SegmentGroup>
      <div role="group" aria-label="Zeitraum" className={SEGMENT_TRACK}>
        {HISTORY_RANGE_OPTIONS.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={segmentItemClass(active)}
            >
              {active ? <SegmentPill /> : null}
              <SegmentLabel>{option.label}</SegmentLabel>
            </button>
          );
        })}
      </div>
    </SegmentGroup>
  );
}
