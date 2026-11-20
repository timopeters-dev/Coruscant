"use client";

import { Building2, Link2, Unlink } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import { Select } from "@/frontend/ui/select";
import { formatCentsDE } from "@/domain/core/money";
import { getContractTypeLabel } from "../labels";
import { type PropertyDetailState } from "./use-property-detail";

/** Verknüpfte und zuordenbare Verträge des Objekts. */
export function PropertyLinkedContractsSection({ ws }: { ws: PropertyDetailState }) {
  const {
    handleLinkContract, handleUnlinkContract, isBusy, linkedContracts, mutatingContractId,
    onSelectContract, projectionsById, selectedContractToLink, setSelectedContractToLink,
    unlinkedContracts,
  } = ws;
  return (
    <>
      {/* Verknüpfte Verträge */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 section-label text-[var(--text-secondary)]">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Verknüpfte Verträge ({linkedContracts.length})</span>
        </div>

        {linkedContracts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-sub)] p-4 text-xs text-[var(--text-secondary)]">
            Dieser Immobilie sind noch keine Kredite oder Bausparverträge
            zugeordnet.
          </p>
        ) : (
          <div className="space-y-2">
            {linkedContracts.map((contract) => {
              const projection = projectionsById[contract.id];
              const balanceCents =
                projection?.projectedBalanceCents ??
                contract.currentBalanceCents;
              const isMutatingThis = mutatingContractId === contract.id;

              return (
                <div
                  key={contract.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-2 transition-colors hover:bg-[var(--surface-elevated)]"
                >
                  <button
                    type="button"
                    onClick={() => onSelectContract(contract)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg p-1 text-left outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {contract.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {getContractTypeLabel(
                          contract.category,
                          contract.repaymentType,
                        )}
                        {contract.status === "closed" ? " · Beendet" : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 tabular-nums text-sm font-semibold ${
                        contract.category === "loan"
                          ? "text-[var(--rose)]"
                          : "text-[var(--sky)]"
                      }`}
                    >
                      {formatCentsDE(balanceCents)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUnlinkContract(contract.id)}
                    disabled={isBusy}
                    title="Verknüpfung lösen"
                    aria-label={`Verknüpfung von ${contract.name} lösen`}
                    className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--rose)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Unlink
                      className={`h-3.5 w-3.5 ${isMutatingThis ? "animate-pulse" : ""}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {unlinkedContracts.length > 0 ? (
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
            <Select
              aria-label="Bestehenden Vertrag verknüpfen"
              value={selectedContractToLink}
              onChange={(e) => setSelectedContractToLink(e.target.value)}
              disabled={isBusy}
              className="flex-1"
            >
              <option value="">Bestehenden Vertrag verknüpfen…</option>
              {unlinkedContracts.map((contract) => {
                const balanceCents =
                  projectionsById[contract.id]?.projectedBalanceCents ??
                  contract.currentBalanceCents;
                return (
                  <option key={contract.id} value={contract.id}>
                    {contract.name} (
                    {getContractTypeLabel(
                      contract.category,
                      contract.repaymentType,
                    )}{" "}
                    · {formatCentsDE(balanceCents)})
                  </option>
                );
              })}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLinkContract}
              disabled={!selectedContractToLink || isBusy}
              className="shrink-0"
            >
              <Link2 className="h-3.5 w-3.5" />
              Verknüpfen
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
