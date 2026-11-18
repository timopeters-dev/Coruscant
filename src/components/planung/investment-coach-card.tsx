"use client";

import * as React from "react";
import { MessageCircleQuestion } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isInvestmentContextUsable,
  type InvestmentContext,
} from "@/lib/domain/investment-context";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  ASSET_CLASS_LABELS,
  formatCoverageTenthsDE,
} from "./coach-labels";
import { InvestmentCoachDrawer } from "./investment-coach-drawer";

interface InvestmentCoachCardProps {
  context: InvestmentContext;
  /** Ref → lokales Label; nur für die UI, geht nie an die KI. */
  refLabels: Record<string, string>;
}

const SEGMENT_CLASS = {
  etf: "bg-[var(--accent)]",
  stock: "bg-[var(--sky)]",
  crypto: "bg-[var(--text-secondary)]",
} as const;

export function InvestmentCoachCard({
  context,
  refLabels,
}: InvestmentCoachCardProps) {
  const [open, setOpen] = React.useState(false);
  const usable = isInvestmentContextUsable(context);
  const coverage = context.emergencyFund.configured
    ? context.emergencyFund.coverageMonthsTenths
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Investment-Coach</CardTitle>
        <p className="text-sm text-[var(--text-secondary)]">
          Einordnung deiner Depot-Aufteilung für Einsteiger – nur auf Klick, ohne
          Änderung gespeicherter Daten.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!usable ? (
          <div className="rounded-lg border border-dashed border-[var(--border-sub)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            <p className="font-medium">Kein Haushalts-Depot vorhanden</p>
            <p>
              Sobald in finanz_cockpit ein Haushalts-Depot synchronisiert ist,
              erscheint hier die Einordnung.
            </p>
          </div>
        ) : (
          <section
            aria-label="Ist-Allokation"
            className="flex flex-col gap-3 rounded-xl border border-solid border-[var(--border)] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Depotwert{" "}
                <span className="tabular-nums">
                  {formatCentsDE(context.portfolio.totalValueCents)}
                </span>
              </h3>
              <span className="flex items-center gap-2">
                {context.dataQuality.snapshotAgeDays !== null ? (
                  <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                    Stand vor {context.dataQuality.snapshotAgeDays}{" "}
                    {context.dataQuality.snapshotAgeDays === 1 ? "Tag" : "Tagen"}
                  </span>
                ) : null}
                <StatusBadge variant="calibrated" detail="finanz_cockpit" />
              </span>
            </div>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]"
              role="img"
              aria-label="Aufteilung nach Asset-Klassen"
            >
              {context.portfolio.assetClasses.map((c) => (
                <div
                  key={c.assetClass}
                  className={SEGMENT_CLASS[c.assetClass]}
                  style={{ width: `${c.weightBps / 100}%` }}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
              {context.portfolio.assetClasses.map((c) => (
                <li key={c.assetClass} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${SEGMENT_CLASS[c.assetClass]}`}
                    aria-hidden="true"
                  />
                  {ASSET_CLASS_LABELS[c.assetClass]}{" "}
                  <span className="tabular-nums text-[var(--text-primary)]">
                    {formatBpsDE(c.weightBps)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {usable ? (
          <section
            aria-label="Notgroschen-Abdeckung"
            className="flex flex-col gap-1.5 rounded-xl border border-dashed border-[var(--border-sub)] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                <span className="text-[var(--text-secondary)]">
                  Notgroschen-Abdeckung:{" "}
                </span>
                <span className="font-medium tabular-nums">
                  {coverage !== null
                    ? formatCoverageTenthsDE(coverage)
                    : "nicht festgelegt"}
                </span>
              </p>
              <StatusBadge variant="modeled" />
            </div>
            {context.dataQuality.isDummyHousehold ? (
              <p className="text-xs text-[var(--amber)]">
                Beispiel-Haushaltsdaten – eingeschränkte Aussagekraft.
              </p>
            ) : null}
          </section>
        ) : null}

        {usable ? (
          <div>
            <Button onClick={() => setOpen(true)} variant="secondary">
              <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
              Coach öffnen
            </Button>
          </div>
        ) : null}
      </CardContent>

      {usable ? (
        <InvestmentCoachDrawer
          open={open}
          onOpenChange={setOpen}
          context={context}
          refLabels={refLabels}
        />
      ) : null}
    </Card>
  );
}
