import type { PotDeadlineStatus } from "@/lib/domain/pot-deadline";

export const POT_DEADLINE_BADGE_META: Record<
  PotDeadlineStatus,
  { label: string; className: string }
> = {
  reached: {
    label: "Erreicht",
    className: "border-[var(--emerald)]/40 text-[var(--emerald)]",
  },
  on_track: {
    label: "Im Plan",
    className: "border-[var(--border)] text-[var(--text-secondary)]",
  },
  tight: {
    label: "Knapp",
    className: "border-[var(--amber)]/40 text-[var(--amber)]",
  },
  at_risk: {
    label: "Nicht erreichbar",
    className: "border-[var(--rose)]/40 text-[var(--rose)]",
  },
  overdue: {
    label: "Termin verstrichen",
    className: "border-[var(--border)] text-[var(--text-secondary)]",
  },
};
