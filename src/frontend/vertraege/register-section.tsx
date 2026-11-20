import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { formatCentsDE } from "@/domain/core/money";

/** Eine Gruppe im Vertragsregister (Kredite, Bausparer, Immobilien) mit Summe und Leerzustand. */
export function RegisterSection({
  icon: Icon,
  iconClassName,
  title,
  count,
  totalCents,
  totalClassName,
  emptyText,
  onCreate,
  className = "space-y-3",
  children,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  count: number;
  totalCents: number;
  totalClassName: string;
  emptyText: string;
  onCreate: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconClassName}`} />
          <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
          <span className="tabular-nums text-xs text-[var(--text-secondary)]">({count})</span>
        </div>
        <span className={`tabular-nums text-sm font-semibold ${totalClassName}`}>{formatCentsDE(totalCents)}</span>
      </div>
      {count === 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-dashed border-[var(--border-sub)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <span>{emptyText}</span>
          <button type="button" onClick={onCreate} className="font-medium text-[var(--accent)] hover:underline">
            + anlegen
          </button>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
