import { TaxYearOverview } from "@/components/steuer/tax-year-overview";
import { getTaxYearOverview, listTaxCandidateDocuments } from "@/db/queries/tax";
import { getTodayIsoDate } from "@/lib/domain/date";
import { listTaxYears, resolveDefaultTaxYear } from "@/lib/domain/tax-summary";
import { parseTaxYearParam } from "@/lib/validation/tax";

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
