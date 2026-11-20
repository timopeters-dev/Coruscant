"use client";

import { Badge } from "@/frontend/ui/badge";
import { Card, CardContent } from "@/frontend/ui/card";
import { formatCentsDE } from "@/domain/core/money";
import { type AllokationWorkspaceState, formatJournalTimestamp } from "./use-allokation-workspace";

/** Journal der letzten Verteilungen. */
export function AllocationJournal({ ws }: { ws: AllokationWorkspaceState }) {
  const { recentAllocations } = ws;
  return (
    <>
      {/* Sektion 3: Letzte Verteilungen (Journal) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          Letzte Verteilungen
        </h2>

        {recentAllocations.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-xs text-[var(--text-secondary)]">
              Noch keine Wasserfall-Verteilungen verbucht.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-[var(--border)] py-1">
              {recentAllocations.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">
                        {entry.potName}
                      </span>
                      <Badge variant="secondary">{entry.sourceLabel}</Badge>
                    </div>
                    <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                      {formatJournalTimestamp(entry.allocatedAt)}
                    </p>
                  </div>
                  <span className="tabular-nums font-semibold text-[var(--emerald)]">
                    {formatCentsDE(entry.amountCents, { showPlusSign: true })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
