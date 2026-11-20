"use client";

import Link from "next/link";
import { Building2, Landmark } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { formatCentsDE } from "@/domain/core/money";
import { cn } from "@/frontend/ui/cn";
import { InfoTip } from "@/frontend/ui/info-tip";
import { type AllokationWorkspaceState } from "./use-allokation-workspace";

/** Vertragsraten und Objektkosten, die in den Überschuss eingehen. */
export function LinkedItemsSection({ ws }: { ws: AllokationWorkspaceState }) {
  const {
    derivedContractItems, derivedPropertyItems, excludedContractsCount,
    handleToggleIncludeContractItems, handleToggleIncludePropertyItems, includeContractItems,
    includePropertyItems,
  } = ws;
  return (
    <>
      {/* Sektion: Verträge & Objekte im Überschuss */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              Verträge &amp; Objekte im Überschuss
            </h2>
            <StatusBadge variant="modeled" />
            <InfoTip
              id="surplus-contracts-info"
              label="Verträge & Objekte im Überschuss"
              text="Hier kannst du Vertragsraten und Objekt-Cashflows aus Coruscant zusätzlich in den Haushalts-Überschuss einrechnen. Das ist modelliert: Was bereits über das Gemeinschaftskonto erfasst ist, sollte nicht ein zweites Mal gezählt werden."
            />
          </div>
          <span className="text-xs text-[var(--text-secondary)]">
            <span className="tabular-nums">{derivedContractItems.length}</span>{" "}
            Verträge
          </span>
        </div>

        {/* Verknüpfte Coruscant-Vertragsraten (Live-Sync, schreibgeschützt) */}
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="section-label text-[var(--text-secondary)]">
                Verknüpfte Coruscant-Vertragsraten
              </h3>
              <Badge variant="default">Live-Sync</Badge>
              <InfoTip
                id="contract-rates-info"
                label="Verknüpfte Coruscant-Vertragsraten"
                text="Monatliche Raten deiner aktiven Haushalts-Verträge, direkt aus der Vertragsliste gelesen (schreibgeschützt). Änderungen nimmst du unter Verträge vor; hier erscheinen sie automatisch."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={includeContractItems}
                  onChange={handleToggleIncludeContractItems}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
                />
                Zusätzlich vom Haushalts-Überschuss abziehen
              </label>
              <InfoTip
                id="contract-rates-toggle-info"
                label="Zusätzlich vom Haushalts-Überschuss abziehen"
                align="end"
                text="Nur aktivieren, wenn diese Raten nicht schon als Fixkosten über das Gemeinschaftskonto laufen – sonst würden sie doppelt abgezogen und der Überschuss wirkt kleiner, als er ist."
              />
              <Link
                href="/vertraege"
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Verträge verwalten
              </Link>
            </div>
          </div>
          <p className="text-2xs text-[var(--text-secondary)]">
            {includeContractItems
              ? "Aktiviert: Diese Vertragsraten werden zusätzlich zu den Gemeinschaftskonto-Fixkosten abgezogen."
              : "Standardmäßig deaktiviert, um Doppelzählungen mit bereits über das Gemeinschaftskonto erkannten Fixkosten zu vermeiden."}
          </p>

          {derivedContractItems.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Keine aktiven Haushalts-Verträge mit monatlicher Rate vorhanden.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {derivedContractItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Landmark
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {item.name}
                    </span>
                  </div>
                  <span className="tabular-nums shrink-0 font-semibold text-[var(--rose)]">
                    −{formatCentsDE(item.amountCents)} / Mon.
                  </span>
                </div>
              ))}
            </div>
          )}

          {excludedContractsCount > 0 ? (
            <p className="text-2xs text-[var(--text-secondary)]">
              Hinweis:{" "}
              <span className="tabular-nums">{excludedContractsCount}</span>{" "}
              pausierte, geschlossene oder ratenlose Verträge fließen nicht in
              den Haushalts-Cashflow ein.
            </p>
          ) : null}
        </div>

        {derivedPropertyItems.length > 0 ? (
          <div className="space-y-2.5 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="section-label text-[var(--text-secondary)]">
                  Mieten &amp; Objektkosten (Modelliert)
                </h3>
                <Badge variant="outline">Objekt</Badge>
                <InfoTip
                  id="property-items-info"
                  label="Mieten & Objektkosten"
                  text="Aus deinen vermieteten Objekten abgeleitet: Kaltmiete als Zufluss, nicht umlagefähige Kosten und aktive verknüpfte Kreditraten als Abfluss. Modelliert – die Werte stammen aus den Objektdaten, nicht aus Kontobewegungen."
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={includePropertyItems}
                    onChange={handleToggleIncludePropertyItems}
                    className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
                  />
                  In Haushalts-Überschuss einrechnen
                </label>
                <InfoTip
                  id="property-items-toggle-info"
                  label="In Haushalts-Überschuss einrechnen"
                  align="end"
                  text="Rechnet die Objekt-Cashflows in den monatlichen Überschuss ein. Deaktivieren, wenn Miete oder Rate bereits über das Gemeinschaftskonto erfasst sind."
                />
                <Link
                  href="/vertraege?tab=portfolio"
                  className="text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Portfolio ansehen
                </Link>
              </div>
            </div>
            <p className="text-2xs text-[var(--text-secondary)]">
              Abgeleitet aus vermieteten Objekten inkl. verknüpfter
              Haushalts-Kreditraten (ohne Doppelzählung bei aktiven
              Vertragsraten). Falls Miete oder Rate bereits im Gemeinschaftskonto
              erfasst sind, bitte entsprechend deaktivieren.
            </p>
            <div className="divide-y divide-[var(--border)]">
              {derivedPropertyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {item.name}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "tabular-nums shrink-0 font-semibold",
                      item.direction === "inflow"
                        ? "text-[var(--emerald)]"
                        : "text-[var(--rose)]",
                    )}
                  >
                    {item.direction === "inflow" ? "+" : "−"}
                    {formatCentsDE(item.amountCents)} / Mon.
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
