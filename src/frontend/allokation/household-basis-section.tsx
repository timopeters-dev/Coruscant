"use client";

import { RefreshCw } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { formatCentsDE } from "@/domain/core/money";
import { cn } from "@/frontend/ui/cn";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";
import { type AllokationWorkspaceState } from "./use-allokation-workspace";

/** Gemeinschaftskonto aus Bespin: Einnahmen, Ausgaben und Basis für variable Kosten. */
export function HouseholdBasisSection({ ws }: { ws: AllokationWorkspaceState }) {
  const {
    breakdownOpen, handleSyncBridge, householdData, isSyncingBridge, setBreakdownOpen,
    variableBasis,
  } = ws;
  return (
    <>
      {/* Sektion: Gemeinschaftskonto-Basis (falls Snapshot oder Dev-Vorschau vorhanden) */}
      {householdData.household ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                Gemeinschaftskonto-Basis
              </h2>
              {householdData.isDummy ? (
                <StatusBadge
                  variant="modeled"
                  label="Dev-Vorschau"
                  detail="Dummy-Daten"
                />
              ) : (
                <StatusBadge variant="calibrated" />
              )}
            </div>
            {householdData.bridgeConfigured ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={isSyncingBridge}
                onClick={handleSyncBridge}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isSyncingBridge && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                {isSyncingBridge ? "Gleiche ab …" : "Jetzt abgleichen"}
              </Button>
            ) : null}
          </div>

          {householdData.household.categoriesBreakdown.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] ">
              <button
                type="button"
                onClick={() => setBreakdownOpen((prev) => !prev)}
                aria-expanded={breakdownOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>
                  Aufschlüsselung variabler Kategorien (
                  <span className="tabular-nums">
                    {householdData.household.categoriesBreakdown.length}
                  </span>
                  )
                </span>
                <CollapseChevron open={breakdownOpen} />
              </button>

              <Collapse open={breakdownOpen}>
                <div className="overflow-x-auto border-t border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)]/60 text-left text-[var(--text-secondary)]">
                        <th className="px-4 py-2 font-medium">Kategorie</th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "budget" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Plan-Budget
                        </th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "avg_3m" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Ø 3 Monate
                        </th>
                        <th
                          className={cn(
                            "px-4 py-2 text-right font-medium",
                            variableBasis === "avg_6m" &&
                              "text-[var(--text-primary)]",
                          )}
                        >
                          Ø 6 Monate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {householdData.household.categoriesBreakdown.map(
                        (cat) => (
                          <tr key={cat.categoryId}>
                            <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                {cat.categoryName}
                              </span>
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "budget"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.budgetCents)}
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "avg_3m"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.avg3MCents)}
                            </td>
                            <td
                              className={cn(
                                "tabular-nums px-4 py-2.5 text-right",
                                variableBasis === "avg_6m"
                                  ? "font-semibold text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {formatCentsDE(cat.avg6MCents)}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </Collapse>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
