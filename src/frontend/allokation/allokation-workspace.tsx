"use client";

import { Plus, Send } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import { AllocateModal } from "./allocate-modal";
import { PotModal } from "./pot-modal";
import { type AllokationWorkspaceProps, useAllokationWorkspace } from "./use-allokation-workspace";
import { AllocationOverview } from "./allocation-overview";
import { HouseholdBasisSection } from "./household-basis-section";
import { LinkedItemsSection } from "./linked-items-section";
import { PotListSection } from "./pot-list-section";
import { AllocationJournal } from "./allocation-journal";

export function AllokationWorkspace(props: AllokationWorkspaceProps) {
  const ws = useAllokationWorkspace(props);
  const {
    actionError, activePrefill, allocateModalOpen, consolidatedSummary, contracts, editingPot,
    linkOptions, pendingTransferCentsByPotId, potModalOpen, pots, properties, router,
    setActivePrefill, setAllocateModalOpen, setEditingPot, setPotModalOpen,
    setShowInvalidPrefillNotice, setTransferPlanNotice, showInvalidPrefillNotice,
    transferPlanNotice,
  } = ws;
  return (
    <div className="space-y-8">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="page-title">
            Cashflow &amp; Wasserfall
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Gemeinschaftskonto aus Bespin, Verträge und priorisierte
            Ziel-Töpfe.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEditingPot(null);
              setPotModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Topf
          </Button>
          <Button
            onClick={() => setAllocateModalOpen(true)}
            disabled={pots.length === 0}
            title={
              pots.length === 0
                ? "Lege zuerst mindestens einen Ziel-Topf an."
                : undefined
            }
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Geld verteilen
          </Button>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-4 py-2.5 text-xs text-[var(--rose)]">
          {actionError}
        </div>
      ) : null}

      {showInvalidPrefillNotice ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-2.5 text-xs text-[var(--text-primary)]">
          <span>Übernahme nicht möglich – Töpfe haben sich geändert.</span>
          <button
            type="button"
            onClick={() => setShowInvalidPrefillNotice(false)}
            className="font-medium underline underline-offset-2"
          >
            Schließen
          </button>
        </div>
      ) : null}

      {transferPlanNotice !== null ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          Für{" "}
          <span className="tabular-nums font-medium">{transferPlanNotice}</span>{" "}
          gekoppelte {transferPlanNotice === 1 ? "Topf" : "Töpfe"} bitte die
          Überweisung ausführen – der Stand aktualisiert sich beim nächsten
          Sync.
        </div>
      ) : null}

      <AllocationOverview ws={ws} />

      <HouseholdBasisSection ws={ws} />

      <LinkedItemsSection ws={ws} />

      <PotListSection ws={ws} />

      <AllocationJournal ws={ws} />

      {/* Modals */}
      <PotModal
        open={potModalOpen}
        onOpenChange={setPotModalOpen}
        initialPot={editingPot}
        existingPots={pots}
        linkOptions={linkOptions}
        properties={properties}
        contracts={contracts}
        onSaved={() => router.refresh()}
      />

      <AllocateModal
        open={allocateModalOpen}
        onOpenChange={(nextOpen) => {
          setAllocateModalOpen(nextOpen);
          if (!nextOpen && activePrefill) {
            setActivePrefill(null);
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", "/allokation");
            }
          }
        }}
        pots={pots}
        pendingTransferCentsByPotId={pendingTransferCentsByPotId}
        monthlySurplusCents={consolidatedSummary.monthlySurplusCents}
        prefill={activePrefill}
        onAllocated={({ transferPlanCount }) => {
          setTransferPlanNotice(transferPlanCount > 0 ? transferPlanCount : null);
          setActivePrefill(null);
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/allokation");
          }
          router.refresh();
        }}
      />
    </div>
  );
}
