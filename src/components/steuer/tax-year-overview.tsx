import { formatDateDE } from "@/lib/domain/date-format";
import Link from "next/link";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { DokumenteViewSwitch } from "@/components/dokumente/dokumente-view-switch";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { TaxYearOverview as TaxYearOverviewData } from "@/db/queries/tax";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  TAX_BUCKET_HINTS,
  TAX_BUCKET_LABELS,
  TAX_DISCLAIMER,
  TAX_ISSUE_LABELS,
} from "@/lib/domain/tax-labels";
import type {
  Section35aEstimate,
  TaxBucketSummary,
  TaxSummaryItem,
} from "@/lib/domain/tax-summary";
import { TaxExportActions } from "./tax-export-actions";
import { TaxYearSelect } from "./tax-year-select";

interface TaxYearOverviewProps {
  data: Pick<TaxYearOverviewData, "summary" | "availableYears" | "propertyNames">;
  todayIsoDate: string;
}

function Kpi({
  label,
  value,
  modeled = false,
}: {
  label: string;
  value: string;
  modeled?: boolean;
}) {
  return (
    <div
      className={`print-avoid-break rounded-xl border bg-[var(--surface)] p-5 ${
        modeled ? "border-dashed border-[var(--border-sub)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        {modeled ? <StatusBadge variant="modeled" /> : null}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

function Section35aBlock({
  estimate,
  year,
}: {
  estimate: Section35aEstimate;
  year: number;
}) {
  if (estimate.ruleStatus === "no_rule" || !estimate.rule) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border-sub)] p-3 text-xs text-[var(--text-secondary)]">
        Für {year} liegt keine § 35a-Regel vor – kein Richtwert.
      </p>
    );
  }
  const { rule } = estimate;
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-[var(--border-sub)] p-3 text-xs text-[var(--text-secondary)]">
      <p className="tabular-nums">
        {formatBpsDE(rule.rateBps)} von {formatCentsDE(estimate.laborBaseCents)}{" "}
        Lohnanteil = {formatCentsDE(estimate.rawCreditCents)}
        {estimate.isCapped ? (
          <>
            {" "}
            → Höchstbetrag {formatCentsDE(rule.maxCreditCents)} ({rule.legalReference})
          </>
        ) : null}
      </p>
      <p className="tabular-nums font-medium text-[var(--text-primary)]">
        Richtwert: {formatCentsDE(estimate.creditCents)}
      </p>
      {estimate.baseAboveCapCents > 0 ? (
        <p className="tabular-nums">
          {formatCentsDE(estimate.baseAboveCapCents)} Lohnanteil über dem Höchstbetrag
        </p>
      ) : null}
      {estimate.ruleStatus === "unreviewed" ? (
        <p className="text-[var(--amber)]">
          Rechtsstand für {year} nicht geprüft – Stand prüfen.
        </p>
      ) : null}
    </div>
  );
}

function BucketCard({ bucket, year }: { bucket: TaxBucketSummary; year: number }) {
  const hint = TAX_BUCKET_HINTS[bucket.bucket];
  return (
    <Card className="print-avoid-break space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {TAX_BUCKET_LABELS[bucket.bucket]}
          </h3>
          <p className="text-xs tabular-nums text-[var(--text-secondary)]">
            {bucket.documentCount} {bucket.documentCount === 1 ? "Beleg" : "Belege"}
          </p>
        </div>
        {bucket.incompleteCount > 0 ? (
          <StatusBadge
            variant="calibration_warning"
            label={`${bucket.incompleteCount} unvollständig`}
          />
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-[var(--text-secondary)]">
            {bucket.isExcludedFromDeductibleTotal ? "Erfasste Beträge" : "Gesamt"}
          </dt>
          <dd className="font-semibold tabular-nums text-[var(--text-primary)]">
            {formatCentsDE(bucket.totalAmountCents)}
          </dd>
        </div>
        {bucket.isExcludedFromDeductibleTotal ? null : (
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">Absetzbar</dt>
            <dd className="font-semibold tabular-nums text-[var(--emerald)]">
              {formatCentsDE(bucket.deductibleAmountCents)}
            </dd>
          </div>
        )}
      </dl>
      {bucket.section35a ? (
        <Section35aBlock estimate={bucket.section35a} year={year} />
      ) : null}
      {hint ? <p className="text-xs text-[var(--text-secondary)]">{hint}</p> : null}
    </Card>
  );
}

function ItemRow({
  item,
  propertyName,
  isInformational,
}: {
  item: TaxSummaryItem;
  propertyName: string | null;
  isInformational: boolean;
}) {
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-3 py-2 tabular-nums">{item.documentDate ? formatDateDE(item.documentDate) : "–"}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-[var(--text-primary)]">{item.issuer ?? "–"}</div>
        <div className="text-xs text-[var(--text-secondary)]">{item.filename}</div>
      </td>
      <td className="px-3 py-2">{propertyName ?? "–"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {item.totalAmountCents === null ? "–" : formatCentsDE(item.totalAmountCents)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {isInformational || item.deductibleAmountCents === null
          ? "–"
          : formatCentsDE(item.deductibleAmountCents)}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {item.issues.map((issue) => (
            <StatusBadge
              key={issue}
              variant="calibration_warning"
              label={TAX_ISSUE_LABELS[issue]}
            />
          ))}
        </div>
      </td>
      <td className="px-3 py-2 print:hidden">
        <a
          href={`/api/documents/${item.documentId}/file`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          PDF
        </a>
      </td>
    </tr>
  );
}

export function TaxYearOverview({ data, todayIsoDate }: TaxYearOverviewProps) {
  const { summary, availableYears, propertyNames } = data;
  const year = summary.taxYear;
  const isEmpty = summary.documentCount === 0;
  const hasModeledCredit = summary.buckets.some((b) => b.section35a !== null);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <DokumenteViewSwitch active="steuer" taxYear={year} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="page-title">
              Steuer-Belegmappe <span className="tabular-nums">{year}</span>
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Verifizierte, steuerrelevante Belege des Jahres – als Übersicht, Druck und ZIP-Mappe.
            </p>
            <p className="hidden text-xs tabular-nums text-[var(--text-secondary)] print:block">
              Erstellt am {formatDateDE(todayIsoDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <TaxYearSelect years={availableYears} selectedYear={year} />
            <TaxExportActions year={year} disabled={isEmpty} />
          </div>
        </div>
      </div>

      {summary.pendingReviewCount > 0 || summary.incompleteCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          {summary.pendingReviewCount > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--amber)]">
              <span className="tabular-nums">
                {summary.pendingReviewCount} Belege für {year} noch in Prüfung
              </span>
              <Link href="/dokumente" className="font-medium underline print:hidden">
                Zur Inbox
              </Link>
            </div>
          ) : null}
          {summary.incompleteCount > 0 ? (
            <StatusBadge
              variant="calibration_warning"
              label={`${summary.incompleteCount} Belege unvollständig`}
            />
          ) : null}
        </div>
      ) : null}

      {isEmpty ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <FileCheck2 className="mb-2 h-8 w-8 text-[var(--text-secondary)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Keine verifizierten steuerrelevanten Belege für{" "}
              <span className="tabular-nums">{year}</span>
            </p>
            <Link
              href="/dokumente"
              className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline print:hidden"
            >
              Belege in der Inbox prüfen
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Belege" value={String(summary.documentCount)} />
            <Kpi label="Gesamtbetrag" value={formatCentsDE(summary.totalAmountCents)} />
            <Kpi
              label="Absetzbar gesamt (ohne Kapitalerträge)"
              value={formatCentsDE(summary.totalDeductibleCents)}
            />
            {hasModeledCredit ? (
              <Kpi
                label="§ 35a-Richtwert"
                value={formatCentsDE(summary.section35aCreditCents)}
                modeled
              />
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {summary.buckets.map((bucket) => (
              <BucketCard key={bucket.bucket} bucket={bucket} year={year} />
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm),inset_0_1px_0_0_var(--hairline-highlight)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-elevated)] text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Datum</th>
                  <th className="px-3 py-2 font-medium">Aussteller / Datei</th>
                  <th className="px-3 py-2 font-medium">Objekt</th>
                  <th className="px-3 py-2 text-right font-medium">Gesamt</th>
                  <th className="px-3 py-2 text-right font-medium">Absetzbar</th>
                  <th className="px-3 py-2 font-medium">Hinweise</th>
                  <th className="px-3 py-2 font-medium print:hidden">PDF</th>
                </tr>
              </thead>
              {summary.buckets.map((bucket) => (
                <tbody key={bucket.bucket} className="print-avoid-break">
                  <tr className="bg-[var(--surface-elevated)]/60">
                    <th
                      colSpan={3}
                      className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-primary)]"
                    >
                      {TAX_BUCKET_LABELS[bucket.bucket]}{" "}
                      <Badge variant="outline" className="tabular-nums">
                        {bucket.documentCount}
                      </Badge>
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                      {formatCentsDE(bucket.totalAmountCents)}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                      {bucket.isExcludedFromDeductibleTotal
                        ? "–"
                        : formatCentsDE(bucket.deductibleAmountCents)}
                    </th>
                    <th />
                    <th className="print:hidden" />
                  </tr>
                  {summary.items
                    .filter((item) => item.bucket === bucket.bucket)
                    .map((item) => (
                      <ItemRow
                        key={item.documentId}
                        item={item}
                        isInformational={bucket.isExcludedFromDeductibleTotal}
                        propertyName={
                          item.linkedPropertyId
                            ? (propertyNames[item.linkedPropertyId] ?? null)
                            : null
                        }
                      />
                    ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

      <p className="text-xs text-[var(--text-secondary)]">{TAX_DISCLAIMER}</p>
    </div>
  );
}
