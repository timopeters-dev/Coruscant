import { CockpitWorkspace } from "@/frontend/cockpit/cockpit-workspace";
import { loadAdvisorReportOutline } from "@/backend/db/queries/advisor-report";
import { loadCockpitData } from "@/backend/db/queries/cockpit";
import type { AdvisorReportOutlineItem } from "@/domain/report/report";

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
