import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
} from "./external-snapshots";
import { listBalanceSnapshots } from "./balance-history";
import { listPots } from "./pots";
import { listContracts } from "./contracts";
import { listProperties } from "./properties";
import { loadPlanningBase } from "./planning-base";
import {
  type BalanceBarBreakdown,
  type BalanceSummary,
  calculateBalanceBarBreakdown,
  calculateHouseholdBalance,
} from "@/domain/cockpit/balance";
import type { BalanceHistoryPoint } from "@/domain/cockpit/balance-history";
import {
  type ActiveMilestonesResult,
  type PotProgressItem,
  selectTopPotProgress,
  selectUpcomingActiveMilestones,
} from "@/domain/cockpit/milestones";
import { computePotSyncPlan } from "@/domain/allocation/pot-sync";
import {
  evaluatePotDeadlines,
  summarizeDeadlineRisks,
} from "@/domain/allocation/pot-deadline";
import { projectContractBalance } from "@/domain/contracts/contract";
import { getTodayIsoDate } from "@/domain/core/date";
import { evaluateSnapshotFreshness } from "@/domain/cockpit/external-sync";
import { summarizeRentalPortfolio } from "@/domain/properties/rental";
import { getFinanzCockpitBridgeConfig } from "@/backend/integrations/finanz-cockpit-client";

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
  latestSnapshotFetchedAt: string | null;
  activeContractsCount: number;
  projectedContractsCount: number;
  projectedAssetContractsCount: number;
  projectedLiabilityContractsCount: number;
  isBridgeConfigured: boolean;
  syncIntervalMinutes: number;
  isSnapshotStale: boolean;
  nextSyncAtMs: number | null;
  rentalPortfolioHint: RentalPortfolioHint | null;
  history: BalanceHistoryPoint[];
}

export interface HouseholdBalanceResult {
  balance: BalanceSummary;
  properties: ReturnType<typeof listProperties>;
  contracts: ReturnType<typeof listContracts>;
  pots: ReturnType<typeof listPots>;
  exclusionByPotId: Map<string, "link_conflict" | "out_of_scope">;
  latestSnapshot: ReturnType<typeof getLatestExternalSnapshot>;
  activeContractsCount: number;
  projectedContractsCount: number;
  projectedAssetContractsCount: number;
  projectedLiabilityContractsCount: number;
}

export {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
};

/**
 * Loads the household balance sheet and contract projection counts using the
 * exact same liquidity exclusion rules as the cockpit.
 */
export function loadHouseholdBalance(
  asOfDate: string = getTodayIsoDate(),
): HouseholdBalanceResult {
  const properties = listProperties();
  const contracts = listContracts();
  const pots = listPots();
  const latestSnapshot = getLatestExternalSnapshot();

  // Pots whose link overlaps another linked pot (double count) or points outside
  // the household must not count towards liquidity.
  const exclusionByPotId = new Map<string, "link_conflict" | "out_of_scope">();
  for (const outcome of computePotSyncPlan({
    pots,
    accounts: parseSnapshotAccounts(latestSnapshot),
    positions: parseSnapshotPositions(latestSnapshot),
  })) {
    if (outcome.status === "link_conflict") {
      exclusionByPotId.set(outcome.potId, "link_conflict");
    } else if (outcome.status === "link_out_of_scope") {
      exclusionByPotId.set(outcome.potId, "out_of_scope");
    }
  }

  const balance = calculateHouseholdBalance({
    asOfDate,
    properties,
    contracts,
    pots: pots.map((pot) => ({
      ...pot,
      liquidityExclusion: exclusionByPotId.get(pot.id) ?? null,
    })),
  });

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
    balance,
    properties,
    contracts,
    pots,
    exclusionByPotId,
    latestSnapshot,
    activeContractsCount,
    projectedContractsCount,
    projectedAssetContractsCount,
    projectedLiabilityContractsCount,
  };
}

export function loadCockpitData(
  asOfDate: string = getTodayIsoDate(),
  now: Date = new Date(),
): CockpitPageData {
  const {
    balance,
    properties,
    contracts,
    pots,
    latestSnapshot,
    activeContractsCount,
    projectedContractsCount,
    projectedAssetContractsCount,
    projectedLiabilityContractsCount,
  } = loadHouseholdBalance(asOfDate);
  const bridgeConfig = getFinanzCockpitBridgeConfig();
  const freshness = evaluateSnapshotFreshness({
    latestFetchedAt: latestSnapshot?.fetchedAt ?? null,
    intervalMinutes: bridgeConfig.syncIntervalMinutes,
    now,
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
    latestSnapshotFetchedAt: latestSnapshot?.fetchedAt ?? null,
    activeContractsCount,
    projectedContractsCount,
    projectedAssetContractsCount,
    projectedLiabilityContractsCount,
    isBridgeConfigured: bridgeConfig.configured,
    syncIntervalMinutes: bridgeConfig.syncIntervalMinutes,
    isSnapshotStale: freshness.shouldSync,
    nextSyncAtMs: freshness.nextSyncAtMs,
    rentalPortfolioHint,
    history: listBalanceSnapshots(),
  };
}
