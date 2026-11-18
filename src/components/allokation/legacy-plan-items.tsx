"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import type { CashflowItemRow } from "@/db/queries/allocation";
import {
  type CashflowFrequency,
  type ConsolidatedCashflowSummary,
  normalizeItemToMonthlyCents,
} from "@/lib/domain/cashflow";
import { formatCentsDE } from "@/lib/domain/money";
import { cn } from "@/lib/utils";
import { CashflowItemModal } from "./cashflow-item-modal";

const FREQUENCY_LABELS: Record<CashflowFrequency, string> = {
  monthly: "monatlich",
  quarterly: "quartalsweise",
  yearly: "jährlich",
};

interface LegacyPlanItemsProps {
  items: CashflowItemRow[];
  summary: Pick<
    ConsolidatedCashflowSummary,
    "manualInflowCents" | "manualOutflowCents"
  >;
  onChanged: () => void;
}

export function LegacyPlanItems({
  items,
  summary,
  onChanged,
}: LegacyPlanItemsProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<CashflowItemRow | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (items.length === 0) {
    return null;
  }

  const activeCount = items.filter((i) => i.active).length;
  const netCents = summary.manualInflowCents - summary.manualOutflowCents;
  const inactiveCount = items.length - activeCount;

  async function handleToggleActive(item: CashflowItemRow) {
    setBusyId(item.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/cashflow-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      if (!response.ok) {
        setActionError("Status der Position konnte nicht geändert werden.");
        return;
      }
      onChanged();
    } catch {
      setActionError("Netzwerkfehler beim Aktualisieren der Position.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/cashflow-items/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setActionError("Position konnte nicht gelöscht werden.");
        return;
      }
      setConfirmDeleteId(null);
      onChanged();
    } catch {
      setActionError("Netzwerkfehler beim Löschen der Position.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border-sub)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
        <p className="tabular-nums">
          {activeCount > 0 ? (
            <>
              {activeCount} {activeCount === 1 ? "aktiver" : "aktive"}{" "}
              Plan-Posten {activeCount === 1 ? "fließt" : "fließen"} mit{" "}
              {formatCentsDE(netCents, { showPlusSign: netCents > 0 })}/Monat in
              den Überschuss ein.
            </>
          ) : (
            <>
              {inactiveCount} {inactiveCount === 1 ? "inaktiver" : "inaktive"}{" "}
              Plan-Posten ({inactiveCount === 1 ? "zählt" : "zählen"} nicht).
            </>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDrawerOpen(true)}
        >
          Verwalten
        </Button>
      </div>

      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => {
          // Escape im Bearbeiten-Modal darf den Drawer nicht mitschließen.
          if (!open && modalOpen) return;
          setDrawerOpen(open);
        }}
        title="Plan-Posten (Auslauf)"
        subtitle="Neue Plan-Posten werden nicht mehr angelegt. Bestehende kannst du bearbeiten, deaktivieren oder löschen."
      >
        <div className="space-y-2">
          {actionError ? (
            <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-4 py-2.5 text-xs text-[var(--rose)]">
              {actionError}
            </div>
          ) : null}
          {items.map((item) => {
            const monthlyCents = normalizeItemToMonthlyCents(
              item.amountCents,
              item.frequency,
            );
            const isConfirming = confirmDeleteId === item.id;

            return (
              <Card
                key={item.id}
                className={cn(
                  "border-dashed border-[var(--border-sub)] transition-opacity",
                  !item.active && "opacity-60",
                )}
              >
                <CardContent className="space-y-3 py-3.5">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {item.name}
                      </span>
                      <StatusBadge variant="modeled" />
                      <Badge
                        variant="outline"
                        className={
                          item.direction === "inflow"
                            ? "border-[var(--emerald)]/35 bg-[var(--emerald)]/10 text-[var(--emerald)]"
                            : "border-[var(--rose)]/35 bg-[var(--rose)]/10 text-[var(--rose)]"
                        }
                      >
                        {item.direction === "inflow" ? "Einnahme" : "Ausgabe"}
                      </Badge>
                      {!item.active ? (
                        <Badge variant="secondary">Inaktiv</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Original:{" "}
                      <span className="tabular-nums">
                        {formatCentsDE(item.amountCents)}
                      </span>{" "}
                      ({FREQUENCY_LABELS[item.frequency]})
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div
                        className={cn(
                          "tabular-nums text-sm font-semibold",
                          item.direction === "inflow"
                            ? "text-[var(--emerald)]"
                            : "text-[var(--rose)]",
                        )}
                      >
                        {item.direction === "inflow" ? "+" : "−"}
                        {formatCentsDE(monthlyCents)}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        pro Monat
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={() => handleToggleActive(item)}
                      >
                        {item.active ? "Deaktivieren" : "Aktivieren"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${item.name} bearbeiten`}
                        onClick={() => {
                          setEditingItem(item);
                          setModalOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busyId === item.id}
                            className="border-[var(--rose)]/40 text-[var(--rose)]"
                            onClick={() => handleDelete(item.id)}
                          >
                            Bestätigen
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Abbruch
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${item.name} löschen`}
                          onClick={() => setConfirmDeleteId(item.id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Sheet>

      <CashflowItemModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialItem={editingItem}
        onSaved={onChanged}
      />
    </>
  );
}
