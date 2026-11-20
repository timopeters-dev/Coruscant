import { cn } from "@/frontend/ui/cn";
import { CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";

interface LegendSwatchProps {
  role: ChartRole;
  dashed?: boolean;
  shape?: "box" | "line";
  label: string;
}

export function LegendSwatch({
  role,
  dashed = false,
  shape = "box",
  label,
}: LegendSwatchProps) {
  const color = CHART_ROLE_COLOR[role];
  return (
    <span className="inline-flex items-center gap-1.5">
      {shape === "line" ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block w-5 border-t-2",
            dashed ? "border-dashed" : "border-solid",
          )}
          style={{ borderColor: color }}
        />
      ) : (
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
      )}
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
