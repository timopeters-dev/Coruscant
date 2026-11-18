import type { ExternalSnapshotRow } from "@/db/schema";
import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
} from "@/db/queries/external-snapshots";
import { listPots } from "@/db/queries/allocation";
import { listContracts, listProperties } from "@/db/queries/contracts";
import { loadPlanningBase } from "@/db/queries/planning-base";
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
import { computePotSyncPlan } from "@/lib/domain/pot-sync";
import {
  evaluatePotDeadlines,
  summarizeDeadlineRisks,
} from "@/lib/domain/pot-deadline";
import { projectContractBalance } from "@/lib/domain/contracts";
import { getTodayIsoDate } from "@/lib/domain/date";
import { evaluateSnapshotFreshness } from "@/lib/domain/external-sync";
import { summarizeRentalPortfolio } from "@/lib/domain/rental";
import { getFinanzCockpitBridgeConfig } from "@/lib/integrations/finanz-cockpit-client";

export interface RentalPortfolioHint {
  propertyCount: number;
  netCashflowBeforeReserveCents: number;
}

export interface CockpitPageData {
  asOfDate: string;
  balance: BalanceSummary;
  barBreakdown: BalanceBarBreakdown;
  milestones: ActiveMilestonesResult;
  potDeadlines: ReturnType<typeof summarizeDeadlineRisks>;
  topPots: PotProgressItem[];
  latestSnapshot: ExternalSnapshotRow | null;
  activeContractsCount: number;
  projectedContractsCount: number;
  projectedAssetContractsCount: number;
  projectedLiabilityContractsCount: number;
  isBridgeConfigured: boolean;
  syncIntervalMinutes: number;
  isSnapshotStale: boolean;
  nextSyncAtMs: number | null;
  rentalPortfolioHint: RentalPortfolioHint | null;
}

export {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
};

export function loadCockpitData(
  asOfDate: string = getTodayIsoDate(),
  now: Date = new Date(),
): CockpitPageData {
  const properties = listProperties();
  const contracts = listContracts();
  const pots = listPots();
  const latestSnapshot = getLatestExternalSnapshot();
  const bridgeConfig = getFinanzCockpitBridgeConfig();
  const freshness = evaluateSnapshotFreshness({
    latestFetchedAt: latestSnapshot?.fetchedAt ?? null,
    intervalMinutes: bridgeConfig.syncIntervalMinutes,
    now,
  });

  // Pots whose link overlaps another linked pot must not be counted twice.
  const conflictingPotIds = new Set(
    computePotSyncPlan({
      pots,
      accounts: parseSnapshotAccounts(latestSnapshot),
      positions: parseSnapshotPositions(latestSnapshot),
    })
      .filter((outcome) => outcome.status === "link_conflict")
      .map((outcome) => outcome.potId),
  );

  const balance = calculateHouseholdBalance({
    asOfDate,
    properties,
    contracts,
    pots: pots.map((pot) => ({
      ...pot,
      excludeFromLiquidity: conflictingPotIds.has(pot.id),
    })),
    externalSnapshot: latestSnapshot,
  });

  const barBreakdown = calculateBalanceBarBreakdown(balance);
  const milestones = selectUpcomingActiveMilestones(contracts, asOfDate, 5);
  const planningBase = loadPlanningBase();
  const potDeadlines = summarizeDeadlineRisks(
    evaluatePotDeadlines({
      pots: planningBase.pots,
      monthlySurplusCents: planningBase.consolidated.monthlySurplusCents,
      todayIsoDate: asOfDate,
    }),
  );
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

  const portfolio = summarizeRentalPortfolio(properties, contracts, asOfDate);
  const rentalPortfolioHint: RentalPortfolioHint | null = portfolio.hasData
    ? {
        propertyCount: portfolio.propertyCount,
        netCashflowBeforeReserveCents:
          portfolio.totals.netCashflowBeforeReserveCents,
      }
    : null;

  return {
    asOfDate,
    balance,
    barBreakdown,
    milestones,
    potDeadlines,
    topPots,
    latestSnapshot,
    activeContractsCount,
    projectedContractsCount,
    projectedAssetContractsCount,
    projectedLiabilityContractsCount,
    isBridgeConfigured: bridgeConfig.configured,
    syncIntervalMinutes: bridgeConfig.syncIntervalMinutes,
    isSnapshotStale: freshness.shouldSync,
    nextSyncAtMs: freshness.nextSyncAtMs,
    rentalPortfolioHint,
  };
}
