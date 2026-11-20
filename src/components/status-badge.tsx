import { cn } from "@/lib/utils";

export type StatusBadgeVariant =
  | "calibrated"
  | "modeled"
  | "ai_suggestion"
  | "calibration_warning";

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  label?: string;
  detail?: string;
  className?: string;
}

/**
 * Kleine Prüfzeichen statt generischer Icons:
 * - Geeicht: Eichmarke (voller Kern im Ring)
 * - Modelliert: gestrichelter Ring, leer – ein Wert ohne Messung
 * - KI-Vorschlag: Raute
 * - Eich-Hinweis: Dreieck
 */
function StatusMark({ variant }: { variant: StatusBadgeVariant }) {
  const common = {
    viewBox: "0 0 12 12",
    className: "h-3 w-3 shrink-0",
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (variant) {
    case "calibrated":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="6" cy="6" r="2.25" fill="currentColor" />
        </svg>
      );
    case "modeled":
      return (
        <svg {...common}>
          <circle
            cx="6"
            cy="6"
            r="4.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeDasharray="2.2 1.6"
          />
        </svg>
      );
    case "ai_suggestion":
      return (
        <svg {...common}>
          <path d="M6 1.25 10.75 6 6 10.75 1.25 6Z" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="6" cy="6" r="1.4" fill="currentColor" />
        </svg>
      );
    case "calibration_warning":
      return (
        <svg {...common}>
          <path d="M6 1.5 11 10.25H1Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M6 5v2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <circle cx="6" cy="8.6" r="0.7" fill="currentColor" />
        </svg>
      );
  }
}

const VARIANT_CONFIG: Record<
  StatusBadgeVariant,
  { defaultLabel: string; containerClass: string; detailClass: string }
> = {
  calibrated: {
    defaultLabel: "Geeicht",
    containerClass:
      "border-solid border-[color-mix(in_srgb,var(--emerald)_45%,transparent)] text-[var(--emerald)]",
    detailClass: "border-[color-mix(in_srgb,var(--emerald)_35%,transparent)]",
  },
  modeled: {
    defaultLabel: "Modelliert",
    containerClass:
      "border-dashed border-[var(--border-sub)] text-[var(--text-secondary)]",
    detailClass: "border-dashed border-[var(--border-sub)]",
  },
  ai_suggestion: {
    defaultLabel: "KI-Vorschlag",
    containerClass:
      "border-solid border-[color-mix(in_srgb,var(--amber)_50%,transparent)] bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] text-[var(--amber)]",
    detailClass: "border-[color-mix(in_srgb,var(--amber)_40%,transparent)]",
  },
  calibration_warning: {
    defaultLabel: "Eich-Hinweis",
    containerClass:
      "border-solid border-[color-mix(in_srgb,var(--amber)_50%,transparent)] bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] text-[var(--amber)]",
    detailClass: "border-[color-mix(in_srgb,var(--amber)_40%,transparent)]",
  },
};

export function StatusBadge({
  variant,
  label,
  detail,
  className,
}: StatusBadgeProps) {
  const config = VARIANT_CONFIG[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-px text-xs font-medium leading-4",
        config.containerClass,
        className,
      )}
    >
      <StatusMark variant={variant} />
      <span>{label ?? config.defaultLabel}</span>
      {detail ? (
        <span
          className={cn(
            "-my-px ml-0.5 border-l py-px pl-1.5 tabular-nums opacity-85",
            config.detailClass,
          )}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}
