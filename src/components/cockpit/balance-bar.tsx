import { formatDateDE } from "@/lib/domain/date-format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BalanceBarBreakdown } from "@/lib/domain/balance";
import type { ComponentDeltas } from "@/lib/domain/balance-history";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";

interface BalanceBarProps {
  breakdown: BalanceBarBreakdown;
  deltas?: ComponentDeltas | null;
  onShowDetails?: () => void;
}

function deltaToneClass(key: "free" | "bound" | "liabilities", deltaCents: number): string {
  if (deltaCents === 0) {
    return "text-[var(--text-secondary)]";
  }
  const isGood = key === "liabilities" ? deltaCents < 0 : deltaCents > 0;
  return isGood ? "text-[var(--emerald)]" : "text-[var(--rose)]";
}

const SEGMENT_META = [
  {
    key: "free",
    label: "Frei",
    description: "Haushalts-Töpfe + finanz_cockpit",
    dotClass: "bg-[var(--emerald)]",
    barClass: "bg-[var(--emerald)]",
  },
  {
    key: "bound",
    label: "Gebunden",
    description: "Immobilien + Sparverträge",
    dotClass: "bg-[var(--sky)]",
    barClass: "bg-[var(--sky)]",
  },
  {
    key: "liabilities",
    label: "Schulden",
    description: "Aktive Kredite & Darlehen",
    dotClass: "bg-[var(--rose)]",
    barClass: "bg-[var(--rose)]",
  },
] as const;

export function BalanceBar({
  breakdown,
  deltas,
  onShowDetails,
}: BalanceBarProps) {
  const values = {
    free: {
      amountCents: breakdown.freeCents,
      shareBps: breakdown.freeShareBps,
      deltaCents: deltas?.freeAssetsDeltaCents ?? null,
    },
    bound: {
      amountCents: breakdown.boundCents,
      shareBps: breakdown.boundShareBps,
      deltaCents: deltas?.boundAssetsDeltaCents ?? null,
    },
    liabilities: {
      amountCents: breakdown.liabilitiesCents,
      shareBps: breakdown.liabilitiesShareBps,
      deltaCents: deltas?.liabilitiesDeltaCents ?? null,
    },
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Vermögensstruktur: Frei vs. Gebunden vs. Schulden
            </CardTitle>
            <CardDescription>
              Normiert auf das Gesamtvolumen (Aktiva + Passiva)
            </CardDescription>
          </div>
          {breakdown.hasData || onShowDetails ? (
            <div className="flex flex-wrap items-center gap-3">
              {breakdown.hasData ? (
                <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                  Gesamtvolumen:{" "}
                  <span className="font-medium text-[var(--text-primary)]">
                    {formatCentsDE(breakdown.totalVolumeCents)}
                  </span>
                </span>
              ) : null}
              {onShowDetails ? (
                <button
                  type="button"
                  onClick={onShowDetails}
                  className="text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:decoration-[var(--text-primary)]"
                >
                  Details
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {breakdown.hasData ? (
          <div className="space-y-1">
          <div
            className="meter flex h-4 w-full overflow-hidden"
            role="img"
            aria-label="Vermögensstruktur Frei, Gebunden und Schulden"
          >
            {SEGMENT_META.map((seg) => {
              const segData = values[seg.key];
              if (segData.shareBps <= 0) return null;
              return (
                <div
                  key={seg.key}
                  className={seg.barClass}
                  style={{ width: `${segData.shareBps / 100}%` }}
                  title={`${seg.label}: ${formatCentsDE(segData.amountCents)} (${formatBpsDE(segData.shareBps)})`}
                />
              );
            })}
          </div>
            <div className="scale-ticks" aria-hidden="true" />
            <div
              className="flex justify-between text-3xs text-[var(--text-muted)]"
              aria-hidden="true"
            >
              <span>0 %</span>
              <span>50 %</span>
              <span>100 %</span>
            </div>
          </div>
        ) : (
          <div className="flex h-4 w-full items-center justify-center rounded-sm border border-dashed border-[var(--border-sub)]">
            <span className="sr-only">Noch keine Vermögensdaten vorhanden</span>
          </div>
        )}

        {!breakdown.hasData ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Noch keine Aktiva oder Verbindlichkeiten erfasst. Lege Verträge,
            Immobilien oder Töpfe an oder synchronisiere mit finanz_cockpit.
          </p>
        ) : null}

        <div className="grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-[var(--border)]">
          {SEGMENT_META.map((seg) => {
            const segData = values[seg.key];
            return (
              <div
                key={seg.key}
                className="sm:px-4 sm:first:pl-0 sm:last:pr-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                    <span
                      className={`h-2.5 w-[3px] ${seg.dotClass}`}
                      aria-hidden="true"
                    />
                    {seg.label}
                  </span>
                  <span className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                    {formatBpsDE(segData.shareBps)}
                  </span>
                </div>
                <div className="figure mt-1 text-xl text-[var(--text-primary)]">
                  {formatCentsDE(segData.amountCents)}
                </div>
                {segData.deltaCents !== null && deltas ? (
                  <p
                    className={`mt-0.5 tabular-nums text-2xs font-medium ${deltaToneClass(seg.key, segData.deltaCents)}`}
                  >
                    {formatCentsDE(segData.deltaCents, { showPlusSign: true })}{" "}
                    seit {formatDateDE(deltas.sinceDate)}
                  </p>
                ) : null}
                <p className="mt-0.5 text-2xs text-[var(--text-secondary)]">
                  {seg.description}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
