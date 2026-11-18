import { cn } from "@/lib/utils";
import { CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";

interface LegendSwatchProps {
  role: ChartRole;
  dashed?: boolean;
  label: string;
}

export function LegendSwatch({ role, dashed = false, label }: LegendSwatchProps) {
  const color = CHART_ROLE_COLOR[role];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-3 w-5 rounded-sm border",
          dashed ? "border-dashed" : "border-solid",
        )}
        style={{
          borderColor: color,
          backgroundColor: dashed
            ? `color-mix(in srgb, ${color} 35%, transparent)`
            : color,
        }}
      />
      {label}
    </span>
  );
}

export function ChartLegend({ items }: { items: LegendSwatchProps[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
      {items.map((item) => (
        <LegendSwatch key={item.label} {...item} />
      ))}
    </div>
  );
}
