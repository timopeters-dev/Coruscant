import { CockpitWorkspace } from "@/components/cockpit/cockpit-workspace";
import { loadCockpitData } from "@/db/queries/cockpit";

export const dynamic = "force-dynamic";

export default function CockpitPage() {
  const data = loadCockpitData();
  return <CockpitWorkspace data={data} />;
}
