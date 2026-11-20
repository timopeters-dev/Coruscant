import { getQuotaSnapshot, listAllPropertyIntervals } from "@/backend/db/queries/property-valuations";
import { json, route } from "@/backend/http";
import { getSchedulerStatusSnapshot } from "@/backend/jobs/scheduler";
import {
  evaluateAutoValuationQuota,
  FREE_TIER_DEFAULT_LIMIT,
  summarizePlannedConsumption,
} from "@/domain/properties/valuation/auto-schedule";

export const dynamic = "force-dynamic";

/** Status der automatischen Bewertung: Konfiguration, Scheduler, Kontingent. */
export const GET = route(() => {
  const now = new Date();
  const snapshot = getQuotaSnapshot();
  return json({
    configured: (process.env.IMMOANALYSE_API_KEY ?? "").trim().length > 0,
    scheduler: getSchedulerStatusSnapshot(now),
    quota: { snapshot, evaluation: evaluateAutoValuationQuota(snapshot, now.toISOString()) },
    plannedConsumption: summarizePlannedConsumption(listAllPropertyIntervals(), snapshot?.limit ?? FREE_TIER_DEFAULT_LIMIT),
  });
});
