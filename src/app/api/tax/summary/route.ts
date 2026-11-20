import { getTaxYearOverview } from "@/backend/db/queries/tax";
import { json, route } from "@/backend/http";
import { requireTaxYear } from "@/backend/services/tax-export";

export const dynamic = "force-dynamic";

export const GET = route((request) => {
  const { summary, availableYears } = getTaxYearOverview(requireTaxYear(request));
  return json({ summary, availableYears }, 200, { "Cache-Control": "private, no-store" });
});
