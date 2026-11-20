"use client";

import { formatMonthDE } from "@/domain/core/date-format";
import { ArrowDown, ArrowUp, Building2, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent } from "@/frontend/ui/card";
import { formatCentsDE } from "@/domain/core/money";
import { buildPotProgressBar } from "@/domain/allocation/surplus-flow";
import { POT_DEADLINE_BADGE_META } from "./deadline-labels";
import { cn } from "@/frontend/ui/cn";
import { PotProgressBar } from "./pot-progress-bar";
import {
  type AllokationWorkspaceState, formatJournalTimestamp, getPotRuleLabel,
} from "./use-allokation-workspace";

/** Priorisierte Ziel-Töpfe: Reihenfolge, Regel, Fortschritt und Fristen. */
export function PotListSection({ ws }: { ws: AllokationWorkspaceState }) {
  const {
    allocatedByPotId, busyId, confirmDeletePotId, contractById, deadlineEvalByPotId,
    handleDeletePot, handleMovePot, linkOptions, linkStatusByPotId, pendingTransferCentsByPotId,
    pots, propertyById, setConfirmDeletePotId, setEditingPot, setPotModalOpen, totalRemainderPct,
  } = ws;
  return (
    <>
      {/* Sektion 2: Priorisierte Ziel-Töpfe */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            Priorisierte Ziel-Töpfe
          </h2>
          <span className="text-xs text-[var(--text-secondary)]">
            Restverteilung:{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {totalRemainderPct} %
            </span>{" "}
            von 100 % vergeben
          </span>
        </div>

        {pots.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-between gap-3 py-8 text-center sm:flex-row sm:text-left">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Noch keine Ziel-Töpfe angelegt
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Lege priorisierte Töpfe für Rücklagen, Sparziele oder
                  Sondertilgungen an.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingPot(null);
                  setPotModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Ersten Topf anlegen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pots.map((pot, index) => {
              const linkedProperty = pot.linkedPropertyId
                ? propertyById.get(pot.linkedPropertyId)
                : undefined;
              const linkedContract = pot.linkedContractId
                ? contractById.get(pot.linkedContractId)
                : undefined;
              const isConfirming = confirmDeletePotId === pot.id;
              const isLinked = pot.externalLinkKind !== null;
              const linkOption = isLinked
                ? linkOptions.find(
                    (o) =>
                      o.kind === pot.externalLinkKind &&
                      o.ref === pot.externalLinkRef,
                  )
                : undefined;
              const linkStatus = linkStatusByPotId[pot.id];
              const isLinkOutOfScope =
                isLinked && linkStatus?.status === "out_of_scope";
              const isLinkMissing =
                isLinked &&
                linkStatus?.status !== "ok" &&
                linkStatus?.status !== "conflict" &&
                linkStatus?.status !== "out_of_scope";
              const isLinkConflict = isLinked && linkStatus?.status === "conflict";
              const isLinkStale =
                isLinkMissing || isLinkConflict || isLinkOutOfScope;

              const hasTarget = pot.targetCents !== null && pot.targetCents > 0;
              const progressPct = hasTarget
                ? Math.min(
                    100,
                    Number(
                      (BigInt(pot.currentCents) * 100n) /
                        BigInt(pot.targetCents!),
                    ),
                  )
                : null;
              const targetReached =
                pot.targetCents !== null && pot.currentCents >= pot.targetCents;

              return (
                <Card
                  key={pot.id}
                  className={cn(
                    !isLinked && "border-dashed border-[var(--border-sub)]",
                  )}
                >
                  <CardContent className="space-y-3 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="figure w-5 shrink-0 text-lg leading-6 text-[var(--text-muted)]"
                            aria-label={`Priorität ${pot.priority}`}
                          >
                            {pot.priority}
                          </span>
                          <span className="truncate text-base font-semibold text-[var(--text-primary)]">
                            {pot.name}
                          </span>
                          <Badge variant="secondary" className="tabular-nums">
                            {getPotRuleLabel(pot)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!isLinked ? (
                            <StatusBadge variant="modeled" />
                          ) : isLinkConflict ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Verknüpfung überschneidet sich"
                              detail="Konto und Position gleichzeitig gekoppelt"
                            />
                          ) : isLinkOutOfScope ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Außerhalb des Haushalts"
                              detail="zählt nicht"
                            />
                          ) : isLinkStale ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Verknüpfung nicht gefunden"
                              detail={
                                pot.externalSyncedAt
                                  ? `Stand vom ${formatJournalTimestamp(pot.externalSyncedAt)}`
                                  : "Noch kein Abgleich"
                              }
                            />
                          ) : (
                            <StatusBadge
                              variant="calibrated"
                              detail={linkOption?.label}
                            />
                          )}
                          {isLinked && !isLinkStale && linkStatus?.clampedNegative ? (
                            <StatusBadge
                              variant="calibration_warning"
                              label="Konto im Minus"
                              detail="Stand auf 0,00 € begrenzt"
                            />
                          ) : null}
                          {isLinked && !isLinkStale && pot.externalSyncedAt ? (
                            <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                              Stand vom{" "}
                              {formatJournalTimestamp(pot.externalSyncedAt)}
                            </span>
                          ) : null}
                        </div>

                        {linkedProperty || linkedContract ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                            {linkedProperty ? (
                              <span className="inline-flex items-center gap-1">
                                <Building2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {linkedProperty.name}
                              </span>
                            ) : null}
                            {linkedContract ? (
                              <span className="inline-flex items-center gap-1">
                                <Landmark
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {linkedContract.name}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                        <div className="text-right">
                          <div className="tabular-nums text-base font-semibold text-[var(--text-primary)]">
                            {formatCentsDE(pot.currentCents)}
                            {pot.targetCents !== null ? (
                              <span className="text-xs font-normal text-[var(--text-secondary)]">
                                {" "}
                                / {formatCentsDE(pot.targetCents)}
                              </span>
                            ) : null}
                          </div>
                          {progressPct !== null ? (
                            <div
                              className={cn(
                                "tabular-nums text-xs font-medium",
                                targetReached
                                  ? "text-[var(--emerald)]"
                                  : "text-[var(--text-secondary)]",
                              )}
                            >
                              {progressPct} % erreicht
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} nach oben verschieben`}
                            disabled={index === 0 || busyId !== null}
                            onClick={() => handleMovePot(index, -1)}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} nach unten verschieben`}
                            disabled={
                              index === pots.length - 1 || busyId !== null
                            }
                            onClick={() => handleMovePot(index, 1)}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${pot.name} bearbeiten`}
                            disabled={busyId !== null}
                            onClick={() => {
                              setEditingPot(pot);
                              setPotModalOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busyId !== null}
                                className="border-[var(--rose)]/40 text-[var(--rose)]"
                                onClick={() => handleDeletePot(pot.id)}
                              >
                                Bestätigen
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId !== null}
                                onClick={() => setConfirmDeletePotId(null)}
                              >
                                Abbruch
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${pot.name} löschen`}
                              disabled={busyId !== null}
                              onClick={() => setConfirmDeletePotId(pot.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <PotProgressBar
                      bar={buildPotProgressBar({
                        currentCents: pot.currentCents,
                        pendingCents: pendingTransferCentsByPotId[pot.id] ?? 0,
                        allocatedCents: allocatedByPotId.get(pot.id) ?? 0,
                        targetCents: pot.targetCents,
                      })}
                      deadlineStatus={deadlineEvalByPotId.get(pot.id)?.status}
                    />

                    {(() => {
                      const deadlineEval = deadlineEvalByPotId.get(pot.id);
                      if (!deadlineEval) {
                        return null;
                      }
                      const badge = POT_DEADLINE_BADGE_META[deadlineEval.status];
                      const formatYm = formatMonthDE;

                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-secondary)]">
                            <StatusBadge variant="modeled" />
                            <span className="tabular-nums font-medium text-[var(--text-primary)]">
                              Termin {formatYm(deadlineEval.targetMonth)}
                            </span>
                            {deadlineEval.status !== "reached" ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {deadlineEval.requiredIsOneTime
                                    ? `Soll: ${formatCentsDE(deadlineEval.requiredMonthlyCents)} einmalig`
                                    : `Soll ${formatCentsDE(deadlineEval.requiredMonthlyCents)}/Monat`}
                                </span>
                                {deadlineEval.plannedMonthlyCents !== null ? (
                                  <>
                                    <span>·</span>
                                    <span className="tabular-nums">
                                      Ist Ø{" "}
                                      {formatCentsDE(
                                        deadlineEval.plannedMonthlyCents,
                                      )}
                                      /Monat
                                    </span>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            {deadlineEval.status === "at_risk" ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums text-[var(--rose)]">
                                  Fehlbetrag zum Termin{" "}
                                  {formatCentsDE(
                                    deadlineEval.shortfallAtDeadlineCents,
                                  )}
                                </span>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {deadlineEval.expectedReachMonth
                                    ? `voraussichtlich erreicht ${formatYm(deadlineEval.expectedReachMonth)}`
                                    : "nicht innerhalb von 40 Jahren"}
                                </span>
                              </>
                            ) : null}
                            {deadlineEval.status === "overdue" &&
                            deadlineEval.shortfallNowCents > 0 ? (
                              <>
                                <span>·</span>
                                <span className="tabular-nums text-[var(--rose)]">
                                  Fehlbetrag{" "}
                                  {formatCentsDE(deadlineEval.shortfallNowCents)}
                                </span>
                              </>
                            ) : null}
                            {pot.externalLinkKind === "position" ? (
                              <>
                                <span>·</span>
                                <span>ohne Kursentwicklung</span>
                              </>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium",
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
