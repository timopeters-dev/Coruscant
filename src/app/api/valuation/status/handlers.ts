import { NextResponse } from "next/server";
import {
  getQuotaSnapshot,
  listAllPropertyIntervals,
} from "@/db/queries/property-valuations";
import { internalErrorResponse } from "@/lib/api/http";
import {
  evaluateAutoValuationQuota,
  FREE_TIER_DEFAULT_LIMIT,
  summarizePlannedConsumption,
} from "@/lib/domain/auto-valuation-schedule";
import { getSchedulerStatusSnapshot } from "@/lib/server/scheduler";

export function createValuationStatusHandler(
  options: {
    nowFn?: () => Date;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return async function GET(): Promise<NextResponse> {
    try {
      const now = (options.nowFn ?? (() => new Date()))();
      const env = options.env ?? process.env;
      const configured = (env.IMMOANALYSE_API_KEY ?? "").trim().length > 0;
      const scheduler = getSchedulerStatusSnapshot(now, env);
      const snapshot = getQuotaSnapshot();
      const evaluation = evaluateAutoValuationQuota(snapshot, now.toISOString());
      const intervals = listAllPropertyIntervals();
      const plannedConsumption = summarizePlannedConsumption(
        intervals,
        snapshot?.limit ?? FREE_TIER_DEFAULT_LIMIT,
      );

      return NextResponse.json(
        {
          configured,
          scheduler,
          quota: {
            snapshot,
            evaluation,
          },
          plannedConsumption,
        },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
