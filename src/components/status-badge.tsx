import { AlertTriangle, Sparkles, CheckCircle2, Calculator } from "lucide-react";
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

const VARIANT_CONFIG: Record<
  StatusBadgeVariant,
  {
    defaultLabel: string;
    containerClass: string;
    dotClass: string;
    Icon: typeof CheckCircle2;
  }
> = {
  calibrated: {
    defaultLabel: "Geeicht",
    containerClass:
      "border-solid border-[var(--emerald)]/35 bg-[var(--emerald)]/10 text-[var(--emerald)]",
    dotClass: "bg-[var(--emerald)]",
    Icon: CheckCircle2,
  },
  modeled: {
    defaultLabel: "Modelliert",
    containerClass:
      "border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
    dotClass: "bg-[var(--text-secondary)]",
    Icon: Calculator,
  },
  ai_suggestion: {
    defaultLabel: "KI-Vorschlag",
    containerClass:
      "border-solid border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]",
    dotClass: "bg-[var(--amber)]",
    Icon: Sparkles,
  },
  calibration_warning: {
    defaultLabel: "Eich-Hinweis",
    containerClass:
      "border-solid border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]",
    dotClass: "bg-[var(--amber)]",
    Icon: AlertTriangle,
  },
};

export function StatusBadge({
  variant,
  label,
  detail,
  className,
}: StatusBadgeProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.Icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        config.containerClass,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{label ?? config.defaultLabel}</span>
      {detail ? (
        <span className="tabular-nums opacity-80">· {detail}</span>
      ) : null}
    </span>
  );
}
