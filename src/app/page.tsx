import { CockpitWorkspace } from "@/components/cockpit/cockpit-workspace";
import { loadAdvisorReportOutline } from "@/db/queries/advisor-report";
import { loadCockpitData } from "@/db/queries/cockpit";
import type { AdvisorReportOutlineItem } from "@/lib/domain/advisor-report";

export const dynamic = "force-dynamic";

export default function CockpitPage() {
  const data = loadCockpitData();
  let advisorOutline: AdvisorReportOutlineItem[] = [];
  try {
    advisorOutline = loadAdvisorReportOutline(data.asOfDate);
  } catch (error) {
    console.error("Failed to load advisor report outline:", error);
    advisorOutline = [];
  }
  return <CockpitWorkspace data={data} advisorOutline={advisorOutline} />;
}
