import crypto from "node:crypto";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { type ExternalSnapshotRow, externalSnapshots } from "@/db/schema";
import { listPots } from "@/db/queries/allocation";
import { listContracts, listProperties } from "@/db/queries/contracts";
import {
  type BalanceBarBreakdown,
  type BalanceSummary,
  calculateBalanceBarBreakdown,
  calculateHouseholdBalance,
} from "@/lib/domain/balance";
import {
  type ActiveMilestonesResult,
  type PotProgressItem,
  selectTopPotProgress,
  selectUpcomingActiveMilestones,
} from "@/lib/domain/cockpit";
import { projectContractBalance } from "@/lib/domain/contracts";
import { getTodayIsoDate } from "@/lib/domain/date";
import { getFinanzCockpitBridgeConfig } from "@/lib/integrations/finanz-cockpit-client";
import type { FinanzCockpitSummary } from "@/lib/validation/external";

export interface CockpitPageData {
  asOfDate: string;
  balance: BalanceSummary;
  barBreakdown: BalanceBarBreakdown;
  milestones: ActiveMilestonesResult;
  topPots: PotProgressItem[];
  latestSnapshot: ExternalSnapshotRow | null;
  activeContractsCount: number;
  projectedContractsCount: number;
  projectedAssetContractsCount: number;
  projectedLiabilityContractsCount: number;
  isBridgeConfigured: boolean;
}

export function getLatestExternalSnapshot(): ExternalSnapshotRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(externalSnapshots)
    .orderBy(desc(externalSnapshots.fetchedAt), desc(externalSnapshots.id))
    .limit(1)
    .get();
  return row ?? null;
}

export function insertExternalSnapshot(
  summary: FinanzCockpitSummary,
): ExternalSnapshotRow {
  const db = getDb();
  const [created] = db
    .insert(externalSnapshots)
    .values({
      id: crypto.randomUUID(),
      source: summary.source,
      liquidCashCents: summary.liquidCashCents,
      etfStocksCents: summary.etfStocksCents,
      cryptoCents: summary.cryptoCents,
      totalPersonalNetWorthCents: summary.totalPersonalNetWorthCents,
      fetchedAt: summary.fetchedAt,
    })
    .returning()
    .all();

  if (!created) {
    throw new Error("Failed to insert external snapshot");
  }
  return created;
}

export function loadCockpitData(
  asOfDate: string = getTodayIsoDate(),
): CockpitPageData {
  const properties = listProperties();
  const contracts = listContracts();
  const pots = listPots();
  const latestSnapshot = getLatestExternalSnapshot();

  const balance = calculateHouseholdBalance({
    asOfDate,
    properties,
    contracts,
    pots,
    externalSnapshot: latestSnapshot,
  });

  const barBreakdown = calculateBalanceBarBreakdown(balance);
  const milestones = selectUpcomingActiveMilestones(contracts, asOfDate, 5);
  const topPots = selectTopPotProgress(pots, 3);

  let activeContractsCount = 0;
  let projectedContractsCount = 0;
  let projectedAssetContractsCount = 0;
  let projectedLiabilityContractsCount = 0;
  for (const contract of contracts) {
    if (contract.status === "active") {
      activeContractsCount += 1;
    }
    if (contract.status !== "closed") {
      const projection = projectContractBalance(contract, asOfDate);
      if (projection.isProjected) {
        projectedContractsCount += 1;
        if (contract.category === "savings_contract") {
          projectedAssetContractsCount += 1;
        } else {
          projectedLiabilityContractsCount += 1;
        }
      }
    }
  }

  return {
    asOfDate,
    balance,
    barBreakdown,
    milestones,
    topPots,
    latestSnapshot,
    activeContractsCount,
    projectedContractsCount,
    projectedAssetContractsCount,
    projectedLiabilityContractsCount,
    isBridgeConfigured: getFinanzCockpitBridgeConfig().configured,
  };
}
