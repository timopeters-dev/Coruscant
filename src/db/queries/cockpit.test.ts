import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { createPot } from "@/db/queries/allocation";
import { insertExternalSnapshot, loadCockpitData } from "@/db/queries/cockpit";
import { createContract, createProperty } from "@/db/queries/contracts";
import { potCreateSchema } from "@/lib/validation/allocation";
import { contractCreateSchema } from "@/lib/validation/contracts";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-cockpit-db-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadCockpitData integration", () => {
  it("counts only truly projected contracts (excluding paused and lump_sum) and consolidates external overdraft", () => {
    createProperty({
      name: "Musterstraße 1",
      usage: "owner_occupied",
      estimatedValueCents: 30_000_000,
    });

    createPot(
      potCreateSchema.parse({
        name: "Notgroschen",
        currentCents: 500_000,
        targetCents: 1_000_000,
        ruleType: "fill_to_target",
      }),
    );

    // Active annuity loan with balanceAsOfDate 2 months before asOfDate -> isProjected === true
    createContract(
      contractCreateSchema.parse({
        name: "Musterbank Annuität",
        provider: "Musterbank",
        sphere: "household",
        category: "loan",
        status: "active",
        currentBalanceCents: 10_000_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 100_000,
        interestRateBps: 300,
        repaymentType: "annuity",
        milestoneDate: "2026-12-15",
        milestoneLabel: "Sondertilgung",
      }),
    );

    // Paused contract with balanceAsOfDate in the past -> isProjected === false
    createContract(
      contractCreateSchema.parse({
        name: "Musterbank Pausiert",
        provider: "Musterbank",
        sphere: "household",
        category: "loan",
        status: "paused",
        currentBalanceCents: 1_000_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 50_000,
        interestRateBps: 0,
        repaymentType: "annuity",
        milestoneDate: "2026-11-20",
        milestoneLabel: "Pausierter Meilenstein",
      }),
    );

    // Active lump_sum loan with balanceAsOfDate in the past -> isProjected === false
    createContract(
      contractCreateSchema.parse({
        name: "Musterbank Endfällig",
        provider: "Musterbank",
        sphere: "household",
        category: "loan",
        status: "active",
        currentBalanceCents: 2_000_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 0,
        interestRateBps: 250,
        repaymentType: "lump_sum",
        milestoneDate: "2027-01-10",
        milestoneLabel: "Rückzahlung",
      }),
    );

    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 2_000_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 1_950_000,
      fetchedAt: "2026-11-16T12:00:00.000Z",
    });

    const data = loadCockpitData("2026-11-16");

    expect(data.activeContractsCount).toBe(2);
    expect(data.projectedContractsCount).toBe(1);
    expect(data.projectedAssetContractsCount).toBe(0);
    expect(data.projectedLiabilityContractsCount).toBe(1);
    expect(data.balance.personalExternalAssetsCents).toBe(2_000_000);
    expect(data.balance.personalLiabilitiesCents).toBe(50_000);
    expect(data.balance.propertiesValueCents).toBe(30_000_000);
    expect(data.balance.householdLiquidCents).toBe(500_000);
    expect(data.milestones.items.map((m) => m.contractName)).toEqual([
      "Musterbank Annuität",
      "Musterbank Endfällig",
    ]);
    expect(data.topPots).toHaveLength(1);
    expect(data.topPots[0]?.progressBps).toBe(5_000);
  });

  it("tracks projectedAssetContractsCount separately from projectedLiabilityContractsCount", () => {
    createContract(
      contractCreateSchema.parse({
        name: "Musterbank Bausparer",
        provider: "Musterbank",
        sphere: "household",
        category: "savings_contract",
        status: "active",
        currentBalanceCents: 1_500_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 25_000,
        interestRateBps: 150,
        repaymentType: "annuity",
        targetSumCents: 5_000_000,
      }),
    );

    const data = loadCockpitData("2026-11-16");
    expect(data.projectedContractsCount).toBe(1);
    expect(data.projectedAssetContractsCount).toBe(1);
    expect(data.projectedLiabilityContractsCount).toBe(0);
  });

  it("evaluates isSnapshotStale and syncIntervalMinutes deterministically", () => {
    const originalInterval = process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES;
    try {
      process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = "15";
      const now = new Date("2026-11-16T12:15:00.000Z");

      // Missing snapshot -> stale
      const withoutSnapshot = loadCockpitData("2026-11-16", now);
      expect(withoutSnapshot.syncIntervalMinutes).toBe(15);
      expect(withoutSnapshot.isSnapshotStale).toBe(true);
      expect(withoutSnapshot.nextSyncAtMs).toBeNull();

      // Stale snapshot (20 min old)
      insertExternalSnapshot({
        source: "finanz_cockpit",
        liquidCashCents: 100_000,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 100_000,
        fetchedAt: "2026-11-16T11:55:00.000Z",
      });
      const withStale = loadCockpitData("2026-11-16", now);
      expect(withStale.isSnapshotStale).toBe(true);
      expect(withStale.nextSyncAtMs).toBeNull();

      // Fresh snapshot (14 min old -> nextSyncAtMs is 1 min after now)
      const freshFetchedAt = "2026-11-16T12:01:00.000Z";
      insertExternalSnapshot({
        source: "finanz_cockpit",
        liquidCashCents: 200_000,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 200_000,
        fetchedAt: freshFetchedAt,
      });
      const withFresh = loadCockpitData("2026-11-16", now);
      expect(withFresh.isSnapshotStale).toBe(false);
      expect(withFresh.nextSyncAtMs).toBe(
        Date.parse(freshFetchedAt) + 15 * 60_000,
      );
    } finally {
      if (originalInterval === undefined) {
        delete process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES;
      } else {
        process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = originalInterval;
      }
    }
  });

  it("does not count a position pot twice when its account is linked as a whole (link_conflict)", () => {
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 0,
      fetchedAt: "2026-11-16T12:00:00.000Z",
      accounts: [
        { id: "acc-depot", name: "Muster-Depot", type: "brokerage", scope: "household", balanceCents: 100_000, holdingsValueCents: 400_000 },
        { id: "acc-other", name: "Muster-Depot 2", type: "brokerage", scope: "household", balanceCents: 0, holdingsValueCents: 400_000 },
      ],
      positions: [
        { id: "pos-1", accountId: "acc-other", symbol: "MSTR", isin: null, name: "Muster-ETF", assetClass: "etf", marketValueCents: 400_000, costBasisCents: null, lastPriceAt: null },
      ],
    });
    const accountPot = createPot(potCreateSchema.parse({ name: "Depot", ruleType: "fixed_monthly", fixedMonthlyCents: 1, externalLink: { kind: "account", ref: "acc-depot" } }));
    const positionPot = createPot(potCreateSchema.parse({ name: "ETF", ruleType: "fixed_monthly", fixedMonthlyCents: 1, externalLink: { kind: "position", ref: "pos-1" } }));
    expect(accountPot.currentCents).toBe(500_000);

    const before = loadCockpitData("2026-11-16");
    expect(before.balance.householdLiquidCents).toBe(900_000);
    expect(before.balance.conflictingLinkedPotsCents).toBe(0);

    // Later the position moves into the linked account.
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 0,
      fetchedAt: "2026-11-16T13:00:00.000Z",
      accounts: [
        { id: "acc-depot", name: "Muster-Depot", type: "brokerage", scope: "household", balanceCents: 100_000, holdingsValueCents: 400_000 },
      ],
      positions: [
        { id: "pos-1", accountId: "acc-depot", symbol: "MSTR", isin: null, name: "Muster-ETF", assetClass: "etf", marketValueCents: 400_000, costBasisCents: null, lastPriceAt: null },
      ],
    });
    const after = loadCockpitData("2026-11-16");
    expect(positionPot.currentCents).toBe(400_000);
    expect(after.balance.householdLiquidCents).toBe(500_000);
    expect(after.balance.conflictingLinkedPotsCents).toBe(400_000);
  });
});
