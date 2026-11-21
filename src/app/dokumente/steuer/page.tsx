import { TaxYearOverview } from "@/frontend/steuer/tax-year-overview";
import { getTaxYearOverview, listTaxCandidateDocuments } from "@/backend/db/queries/tax";
import { getTodayIsoDate } from "@/domain/core/date";
import { listTaxYears, resolveDefaultTaxYear } from "@/domain/tax/summary";
import { parseTaxYearParam } from "@/validation/tax";

export const dynamic = "force-dynamic";

export default async function SteuerPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string | string[] }>;
}) {
  const params = await searchParams;
  const todayIsoDate = getTodayIsoDate();
  const rawYear = Array.isArray(params.jahr) ? params.jahr[0] : params.jahr;

  let year = parseTaxYearParam(rawYear);
  if (year === null) {
    year = resolveDefaultTaxYear(listTaxYears(listTaxCandidateDocuments()), todayIsoDate);
  }

  const data = getTaxYearOverview(year);
  return <TaxYearOverview data={data} todayIsoDate={todayIsoDate} />;
}
