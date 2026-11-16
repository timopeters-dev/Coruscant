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
});
