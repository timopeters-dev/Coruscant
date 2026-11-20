import type * as React from "react";
import { PrintLineChart } from "@/components/bericht/print-line-chart";
import { Badge } from "@/components/ui/badge";
import type {
  AdvisorReportView,
  AdvisorReportViewRecommendation,
} from "@/lib/domain/advisor-report-anonymize";
import {
  formatDataQualityHintDE,
  formatLoanRateChangeLineDE,
  formatLoanSpecialRepaymentLineDE,
} from "@/lib/domain/advisor-report-text";
import { formatBpsDE, formatEuroDE } from "@/lib/domain/money";

interface AdvisorReportDocumentProps {
  view: AdvisorReportView;
  oneTimeInvalid?: boolean;
  questionSlot?: React.ReactNode;
}

function ModeledBadge() {
  return (
    <Badge
      variant="outline"
      className="border-dashed border-[var(--border-sub)] text-3xs text-[var(--text-secondary)]"
    >
      Modelliert
    </Badge>
  );
}

function formatTenthsDE(tenths: number): string {
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return `${whole},${frac}`;
}

function formatDeadlineStatusDE(
  status: NonNullable<AdvisorReportView["pots"][number]["deadline"]>["status"],
): string {
  switch (status) {
    case "reached":
      return "Erreicht";
    case "overdue":
      return "Überfällig";
    case "on_track":
      return "Im Plan";
    case "tight":
      return "Knapp";
    case "at_risk":
      return "Gefährdet";
  }
}

function formatVariableBasisDE(
  basis: AdvisorReportView["cashflow"]["variableBasis"],
): string {
  switch (basis) {
    case "budget":
      return "Budgets";
    case "avg_3m":
      return "3-Monats-Schnitt";
    case "avg_6m":
      return "6-Monats-Schnitt";
  }
}

function RecommendationSectionBlock({
  title,
  rec,
}: {
  title: string;
  rec: AdvisorReportViewRecommendation;
}) {
  return (
    <div className="print-avoid-break rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <ModeledBadge />
      </div>
      <p className="mt-1.5 text-sm text-[var(--text-primary)] tabular-nums">
        {rec.headline}
      </p>

      {rec.items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {rec.items.map((item) => (
            <li
              key={item.ref}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {item.targetLabel}
                </span>
                <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  {formatEuroDE(item.amountCents)}
                </span>
              </div>
              {item.reasons.length > 0 ? (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
                  {item.reasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {rec.notes.length > 0 ? (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            Hinweise
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
            {rec.notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AdvisorReportDocument({
  view,
  oneTimeInvalid = false,
  questionSlot,
}: AdvisorReportDocumentProps) {
  const isFull = view.meta.mode === "full";
  const hasBalance =
    view.balance.totalAssetsCents > 0 || view.balance.liabilitiesCents > 0;
  const hasCashflow =
    view.cashflow.hasHouseholdData ||
    view.cashflow.totalInflowCents > 0 ||
    view.cashflow.totalOutflowCents > 0;

  return (
    <article className="advisor-report mx-auto max-w-4xl space-y-6 text-[var(--text-primary)]">
      {/* Kopf */}
      <header className="print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
              Finanz-Überblick Haushalt
            </h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)] tabular-nums">
              Stand: {view.meta.asOfDateDisplay} · Erstellt:{" "}
              {view.meta.generatedDateDisplay}
            </p>
          </div>
          <Badge variant="default">
            {isFull ? "Vollständig" : "Anonymisiert für KI-Chat"}
          </Badge>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)]">
          {view.meta.disclaimer}
        </div>

        {oneTimeInvalid ? (
          <div className="mt-3 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3.5 py-2 text-xs text-[var(--text-primary)]">
            Betrag ungültig – „Wohin mit X €?“ ausgelassen.
          </div>
        ) : null}
      </header>

      {/* Datenqualität */}
      <section className="print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
          Datenqualität & Aktualität
        </h2>
        {view.dataQuality.hints.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine Auffälligkeiten.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-1.5 rounded-lg border border-[var(--amber)]/35 bg-[var(--amber)]/8 p-3 text-xs text-[var(--text-primary)]">
            {view.dataQuality.hints.map((hint, idx) => (
              <li key={`${hint.code}-${idx}`} className="flex gap-2">
                <span aria-hidden="true" className="text-[var(--amber)]">
                  •
                </span>
                <span>{formatDataQualityHintDE(hint)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 1. Kurzprofil */}
      <section className="print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          1. Kurzprofil
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 p-3">
            <dt className="text-[var(--text-secondary)]">Immobilien</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {view.profile.propertyCount}{" "}
              <span className="text-xs font-normal text-[var(--text-secondary)]">
                ({view.profile.ownerOccupiedCount} eigen /{" "}
                {view.profile.rentedCount} vermietet)
              </span>
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 p-3">
            <dt className="text-[var(--text-secondary)]">Verträge</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {view.profile.loanCount} Kredite ·{" "}
              {view.profile.savingsContractCount} Bausparer
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 p-3">
            <dt className="text-[var(--text-secondary)]">Ziel-Töpfe</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {view.profile.potCount}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 p-3">
            <dt className="text-[var(--text-secondary)]">Notgroschen</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {view.profile.emergencyCoverageMonthsTenths !== null
                ? `${formatTenthsDE(view.profile.emergencyCoverageMonthsTenths)} Mon.`
                : "–"}
            </dd>
          </div>
        </dl>
      </section>

      {/* 2. Bilanz */}
      <section
        className={`print-avoid-break rounded-xl border bg-[var(--surface)] p-5 ${
          view.balance.isModeled
            ? "border-dashed border-[var(--border-sub)]"
            : "border-[var(--border)]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">2. Bilanz</h2>
          {view.balance.isModeled ? <ModeledBadge /> : null}
        </div>
        {!hasBalance ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine Bilanzdaten vorhanden.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-xs text-[var(--text-secondary)]">
                  Aktiva gesamt
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {formatEuroDE(view.balance.totalAssetsCents)}
                </dd>
                <p className="mt-0.5 text-2xs text-[var(--text-secondary)] tabular-nums">
                  Frei: {formatEuroDE(view.balance.freeAssetsCents)} · Gebunden:{" "}
                  {formatEuroDE(view.balance.boundAssetsCents)}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-xs text-[var(--text-secondary)]">
                  Passiva / Schulden
                </dt>
                <dd className="mt-1 text-lg font-semibold text-[var(--rose)] tabular-nums">
                  {formatEuroDE(view.balance.liabilitiesCents)}
                </dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-xs text-[var(--text-secondary)]">
                  Nettovermögen
                </dt>
                <dd
                  className={`mt-1 text-lg font-semibold tabular-nums ${
                    view.balance.netWorthCents >= 0
                      ? "text-[var(--emerald)]"
                      : "text-[var(--rose)]"
                  }`}
                >
                  {formatEuroDE(view.balance.netWorthCents)}
                </dd>
              </div>
            </dl>

            {/* Statischer Balken (Breiten über bps) */}
            <div className="space-y-1.5">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                {view.balance.freeShareBps > 0 ? (
                  <div
                    style={{
                      width: `${view.balance.freeShareBps / 100}%`,
                      backgroundColor: "var(--emerald)",
                    }}
                  />
                ) : null}
                {view.balance.boundShareBps > 0 ? (
                  <div
                    style={{
                      width: `${view.balance.boundShareBps / 100}%`,
                      backgroundColor: "var(--sky)",
                    }}
                  />
                ) : null}
                {view.balance.liabilitiesShareBps > 0 ? (
                  <div
                    style={{
                      width: `${view.balance.liabilitiesShareBps / 100}%`,
                      backgroundColor: "var(--rose)",
                    }}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] tabular-nums">
                <span>Frei: {formatBpsDE(view.balance.freeShareBps)}</span>
                <span>Gebunden: {formatBpsDE(view.balance.boundShareBps)}</span>
                <span>
                  Schulden: {formatBpsDE(view.balance.liabilitiesShareBps)}
                </span>
              </div>
            </div>

            {view.balance.excludedPotsCents > 0 ? (
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                Aus Haushalts-Liquidität ausgeschlossene Töpfe:{" "}
                {formatEuroDE(view.balance.excludedPotsCents)}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* 3. Verlauf */}
      <section
        className={`print-avoid-break rounded-xl border bg-[var(--surface)] p-5 ${
          view.history.anyModeled
            ? "border-dashed border-[var(--border-sub)]"
            : "border-[var(--border)]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">3. Verlauf</h2>
          <div className="flex items-center gap-2">
            {view.history.netWorthDeltaCents !== null ? (
              <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                Delta:{" "}
                {formatEuroDE(view.history.netWorthDeltaCents, {
                  showPlusSign: true,
                })}
              </span>
            ) : null}
            {view.history.anyModeled ? <ModeledBadge /> : null}
          </div>
        </div>

        <div className="mt-3 space-y-4">
          <PrintLineChart rows={view.history.rows} />

          {view.history.rows.length > 0 ? (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-left text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                    <th className="py-2 pr-3 font-medium">Monat</th>
                    <th className="py-2 px-3 text-right font-medium">Frei</th>
                    <th className="py-2 px-3 text-right font-medium">
                      Gebunden
                    </th>
                    <th className="py-2 px-3 text-right font-medium">
                      Schulden
                    </th>
                    <th className="py-2 pl-3 text-right font-medium">
                      Nettovermögen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.rows.map((row) => (
                    <tr
                      key={row.month}
                      className="print-avoid-break border-b border-[var(--border)]/60 last:border-b-0"
                    >
                      <td className="py-1.5 pr-3">
                        {row.monthDisplay}
                        {row.hasModeledValues ? (
                          <span className="ml-1.5 text-3xs text-[var(--text-secondary)]">
                            (Modelliert)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {formatEuroDE(row.freeAssetsCents)}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {formatEuroDE(row.boundAssetsCents)}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[var(--rose)]">
                        {formatEuroDE(row.liabilitiesCents)}
                      </td>
                      <td className="py-1.5 pl-3 text-right font-medium">
                        {formatEuroDE(row.netWorthCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      {/* 4. Verträge & Kredite */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          4. Verträge & Kredite
        </h2>
        {view.contracts.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine aktiven oder pausierten Verträge vorhanden.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                  <th className="py-2 pr-3 font-medium">Vertrag</th>
                  <th className="py-2 px-3 text-right font-medium">Stand</th>
                  <th className="py-2 px-3 text-right font-medium">Rate/Mon.</th>
                  <th className="py-2 px-3 text-right font-medium">Zins</th>
                  <th className="py-2 pl-3 font-medium">Optionen</th>
                </tr>
              </thead>
              <tbody>
                {view.contracts.map((c) => (
                  <tr
                    key={c.ref}
                    className="print-avoid-break border-b border-[var(--border)]/60 align-top last:border-b-0"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium text-[var(--text-primary)]">
                        {c.displayName}
                        {isFull ? (
                          <span className="ml-1.5 text-2xs font-normal text-[var(--text-secondary)]">
                            ({c.ref})
                          </span>
                        ) : null}
                      </div>
                      {c.provider ? (
                        <div className="text-2xs text-[var(--text-secondary)]">
                          {c.provider}
                        </div>
                      ) : null}
                      {c.status === "paused" ? (
                        <Badge variant="secondary" className="mt-1 text-3xs">
                          Pausiert
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="font-medium">
                        {formatEuroDE(c.projectedBalanceCents)}
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1">
                        {c.isProjected ? <ModeledBadge /> : null}
                      </div>
                      <div className="mt-0.5 text-3xs text-[var(--text-secondary)]">
                        Eichung: {c.calibratedAsOfDisplay}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatEuroDE(c.monthlyRateCents)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatBpsDE(c.interestRateBps)}
                    </td>
                    <td className="py-2 pl-3 text-2xs text-[var(--text-secondary)]">
                      <div className="space-y-0.5">
                        {c.fixedInterestUntilDisplay ? (
                          <div>
                            Zinsbindung bis {c.fixedInterestUntilDisplay}
                          </div>
                        ) : null}
                        {c.loanOptions !== null ? (
                          <>
                            <div>
                              {formatLoanSpecialRepaymentLineDE(c.loanOptions)}
                            </div>
                            <div>
                              {formatLoanRateChangeLineDE(c.loanOptions)}
                            </div>
                            {isFull && c.loanOptions.note ? (
                              <div className="pt-0.5 text-3xs italic text-[var(--text-secondary)]">
                                Notiz: {c.loanOptions.note}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {c.targetSumCents !== null ? (
                          <div>
                            Bausparsumme {formatEuroDE(c.targetSumCents)}
                            {c.targetProgressBps !== null
                              ? ` (${formatBpsDE(c.targetProgressBps)})`
                              : ""}
                          </div>
                        ) : null}
                        {c.milestone ? (
                          <div>
                            Meilenstein: {c.milestone.text}
                            {isFull ? ` (${c.milestone.dateDisplay})` : ""}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. Immobilien */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          5. Immobilien
        </h2>
        {view.properties.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine Immobilien hinterlegt.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {view.properties.map((p) => (
              <div
                key={p.ref}
                className="print-avoid-break rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {p.displayName}
                    {isFull ? (
                      <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">
                        ({p.ref})
                      </span>
                    ) : null}
                  </h3>
                  <ModeledBadge />
                </div>

                <dl className="mt-2.5 grid grid-cols-2 gap-3 text-xs tabular-nums sm:grid-cols-4">
                  <div>
                    <dt className="text-[var(--text-secondary)]">Schätzwert</dt>
                    <dd className="mt-0.5 font-semibold">
                      {formatEuroDE(p.estimatedValueCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)]">
                      Verknüpfte Kredite
                    </dt>
                    <dd className="mt-0.5 font-semibold text-[var(--rose)]">
                      {formatEuroDE(p.linkedLoanBalanceCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)]">
                      Eigenkapital
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {formatEuroDE(p.netEquityCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)]">
                      Beleihung (LTV)
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {p.ltvBps !== null ? formatBpsDE(p.ltvBps) : "–"}
                    </dd>
                  </div>
                </dl>

                {p.rental ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-2.5 text-xs tabular-nums">
                    <p className="font-medium text-[var(--text-secondary)]">
                      Vermietung (vor Steuern)
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-primary)]">
                      <span>
                        Kaltmiete: {formatEuroDE(p.rental.monthlyColdRentCents)}
                        /Mon.
                      </span>
                      <span>
                        Nicht umlagefähig:{" "}
                        {formatEuroDE(p.rental.monthlyNonRecoverableCostsCents)}
                        /Mon.
                      </span>
                      <span>
                        Instandhaltung:{" "}
                        {formatEuroDE(p.rental.monthlyMaintenanceAllowanceCents)}
                        /Mon.
                      </span>
                      <span>
                        Netto-CF vor Rücklage:{" "}
                        {formatEuroDE(p.rental.netCashflowBeforeReserveCents, {
                          showPlusSign: true,
                        })}
                        /Mon.
                      </span>
                      {p.rental.grossYieldBps !== null ? (
                        <span>
                          Bruttorendite: {formatBpsDE(p.rental.grossYieldBps)}
                        </span>
                      ) : null}
                      {p.rental.netYieldBps !== null ? (
                        <span>
                          Nettorendite: {formatBpsDE(p.rental.netYieldBps)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Töpfe & Ziele */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          6. Töpfe & Ziele
        </h2>
        {view.pots.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine Ziel-Töpfe vorhanden.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                  <th className="py-2 pr-3 font-medium">Topf</th>
                  <th className="py-2 px-3 text-right font-medium">Stand</th>
                  <th className="py-2 px-3 text-right font-medium">Ziel</th>
                  <th className="py-2 px-3 text-right font-medium">
                    Fortschritt
                  </th>
                  <th className="py-2 pl-3 font-medium">Termin / Status</th>
                </tr>
              </thead>
              <tbody>
                {view.pots.map((pot) => (
                  <tr
                    key={pot.ref}
                    className="print-avoid-break border-b border-[var(--border)]/60 last:border-b-0"
                  >
                    <td className="py-2 pr-3 font-medium">
                      {pot.displayName}
                      {isFull ? (
                        <span className="ml-1.5 text-2xs font-normal text-[var(--text-secondary)]">
                          ({pot.ref})
                        </span>
                      ) : null}
                      {pot.liquidityExclusion ? (
                        <div className="text-3xs font-normal text-[var(--amber)]">
                          Aus Haushalts-Liquidität ausgeschlossen
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatEuroDE(pot.currentCents)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {pot.targetCents !== null
                        ? formatEuroDE(pot.targetCents)
                        : "–"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {pot.progressBps !== null
                        ? formatBpsDE(pot.progressBps)
                        : "–"}
                    </td>
                    <td className="py-2 pl-3 text-[var(--text-secondary)]">
                      {pot.targetMonthDisplay ? (
                        <>
                          {pot.targetMonthDisplay}
                          {pot.deadline
                            ? ` · ${formatDeadlineStatusDE(pot.deadline.status)}`
                            : ""}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7. Cashflow */}
      <section
        className={`print-avoid-break rounded-xl border bg-[var(--surface)] p-5 ${
          view.cashflow.isModeled
            ? "border-dashed border-[var(--border-sub)]"
            : "border-[var(--border)]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            7. Cashflow (monatlich)
          </h2>
          {view.cashflow.isModeled ? <ModeledBadge /> : null}
        </div>
        {!hasCashflow ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Keine Cashflow-Daten vorhanden.
          </p>
        ) : (
          <div className="mt-3 space-y-3 text-xs tabular-nums">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-[var(--text-secondary)]">Einnahmen</dt>
                <dd className="mt-1 text-base font-semibold text-[var(--emerald)]">
                  {formatEuroDE(view.cashflow.totalInflowCents)}
                </dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-[var(--text-secondary)]">Ausgaben</dt>
                <dd className="mt-1 text-base font-semibold text-[var(--rose)]">
                  {formatEuroDE(view.cashflow.totalOutflowCents)}
                </dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <dt className="text-[var(--text-secondary)]">Überschuss</dt>
                <dd
                  className={`mt-1 text-base font-semibold ${
                    view.cashflow.isDeficit
                      ? "text-[var(--rose)]"
                      : "text-[var(--emerald)]"
                  }`}
                >
                  {formatEuroDE(view.cashflow.monthlySurplusCents, {
                    showPlusSign: true,
                  })}
                </dd>
              </div>
            </dl>
            <p className="text-[var(--text-secondary)]">
              Aufteilung: Kalibriert Einnahmen{" "}
              {formatEuroDE(view.cashflow.calibratedInflowCents)} · Fixausgaben{" "}
              {formatEuroDE(view.cashflow.calibratedFixedOutflowCents)} ·
              Variabel ({formatVariableBasisDE(view.cashflow.variableBasis)}){" "}
              {formatEuroDE(view.cashflow.variableOutflowCents)} · Manuell{" "}
              {formatEuroDE(view.cashflow.manualInflowCents)} /{" "}
              {formatEuroDE(view.cashflow.manualOutflowCents)} · Verträge{" "}
              {formatEuroDE(view.cashflow.contractOutflowCents)} · Immobilien{" "}
              {formatEuroDE(view.cashflow.propertyInflowCents)} /{" "}
              {formatEuroDE(view.cashflow.propertyOutflowCents)}
            </p>
          </div>
        )}
      </section>

      {/* 8. Empfehlungen */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            8. Empfehlungen
          </h2>
          <ModeledBadge />
        </div>
        <RecommendationSectionBlock
          title="Monatliche Sparrate"
          rec={view.recommendations.monthly}
        />
        {view.recommendations.oneTime ? (
          <RecommendationSectionBlock
            title={`Wohin mit ${formatEuroDE(view.recommendations.oneTime.amountCents)}?`}
            rec={view.recommendations.oneTime}
          />
        ) : null}
      </section>

      {/* 9. Wobei brauche ich Rat? (Druckblock aus Toolbar) */}
      {questionSlot ?? null}

      {/* 10. Anhang: Annahmen & Methodik */}
      <section className="print-break-before print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          Anhang: Annahmen & Methodik
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-[var(--text-secondary)]">
          <li className="tabular-nums">
            {view.recommendations.monthly.assumptionsSummary}
          </li>
          {view.recommendations.monthly.loanOrder.length > 0 ? (
            <li>
              Kredit-Reihenfolge der Empfehlung:{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {view.recommendations.monthly.loanOrder.join(" → ")}
              </span>
            </li>
          ) : null}
          <li>
            <strong>Modelliert:</strong> Kennzeichnet Schätzwerte (Immobilien),
            ab dem letzten Eich-Datum fortgeschriebene Vertragssalden sowie
            deterministische Simulations- und Empfehlungsrechnungen.
          </li>
          <li>
            <strong>Topf-Basis:</strong> Topf-Stände entsprechen der
            Planungsbasis inkl. offener Überweisungen (identisch zu /allokation
            und /planung).
          </li>
          <li className="tabular-nums">
            <strong>Datenquelle:</strong> Lokale Haushalts-App (Stand{" "}
            {view.meta.asOfDateDisplay}
            {view.dataQuality.snapshotAgeDays !== null
              ? `, letzter Sync vor ${Math.max(0, view.dataQuality.snapshotAgeDays)} Tagen`
              : ", kein Sync-Snapshot vorhanden"}
            ).
          </li>
        </ul>
      </section>
    </article>
  );
}
