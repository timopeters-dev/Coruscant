import { describe, expect, it } from "vitest";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { createPot } from "@/backend/db/queries/pots";
import { listBalanceSnapshots } from "@/backend/db/queries/balance-history";
import { insertExternalSnapshot, loadCockpitData } from "@/backend/db/queries/cockpit";
import { getTodayIsoDate } from "@/domain/core/date";
import { potCreateSchema } from "@/validation/allocation";
import { getBerlinClockSnapshot } from "@/backend/jobs/berlin-clock";
import { runBalanceSnapshotJob } from "@/backend/jobs/balance-snapshot-job";

withTempDatabase();

describe("runBalanceSnapshotJob", () => {
  it("skips on empty DB without writing a row", async () => {
    const res = await runBalanceSnapshotJob({
      now: new Date("2026-11-19T12:00:00Z"),
      trigger: "startup",
    });
    expect(res.status).toBe("skipped");
    expect(listBalanceSnapshots()).toEqual([]);
  });

  it("handles Europe/Berlin day boundaries in winter and summer (DST) identically to getTodayIsoDate", async () => {
    createPot(
      potCreateSchema.parse({
        name: "Notgroschen",
        currentCents: 500_000,
        targetCents: 1_000_000,
        ruleType: "fill_to_target",
      }),
    );

    const winterBefore = new Date("2026-11-19T22:59:00Z"); // 23:59 Berlin
    const winterAfter = new Date("2026-11-19T23:00:00Z"); // 00:00 Berlin
    const summerBefore = new Date("2026-07-01T21:59:00Z"); // 23:59 Berlin (CEST)
    const summerAfter = new Date("2026-07-01T22:00:00Z"); // 00:00 Berlin (CEST)

    for (const d of [winterBefore, winterAfter, summerBefore, summerAfter]) {
      expect(getBerlinClockSnapshot(d).dateKey).toBe(getTodayIsoDate(d));
    }

    await runBalanceSnapshotJob({ now: winterBefore, trigger: "scheduler" });
    await runBalanceSnapshotJob({ now: winterAfter, trigger: "scheduler" });
    await runBalanceSnapshotJob({ now: summerBefore, trigger: "scheduler" });
    await runBalanceSnapshotJob({ now: summerAfter, trigger: "scheduler" });

    expect(listBalanceSnapshots().map((p) => p.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-11-19",
      "2026-11-20",
    ]);
  });

  it("overwrites the same Berlin day on subsequent runs (last wins)", async () => {
    const pot = createPot(
      potCreateSchema.parse({
        name: "Notgroschen",
        currentCents: 500_000,
        targetCents: 1_000_000,
        ruleType: "fill_to_target",
      }),
    );

    const r1 = await runBalanceSnapshotJob({
      now: new Date("2026-11-19T10:00:00Z"),
      trigger: "startup",
    });
    expect(r1.status).toBe("success");

    // Update pot directly via second pot
    createPot(
      potCreateSchema.parse({
        name: "Urlaub",
        currentCents: 250_000,
        targetCents: 500_000,
        ruleType: "fill_to_target",
      }),
    );
    expect(pot.id).toBeTruthy();

    const r2 = await runBalanceSnapshotJob({
      now: new Date("2026-11-19T20:00:00Z"),
      trigger: "sync",
    });
    expect(r2.status).toBe("success");

    const rows = listBalanceSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.freeAssetsCents).toBe(750_000);
  });

  it("excludes link_conflict pots identically to loadCockpitData().balance", async () => {
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 0,
      accounts: [
        {
          id: "acc-depot",
          name: "Muster-Depot",
          type: "brokerage",
          scope: "household",
          balanceCents: 100_000,
          holdingsValueCents: 400_000,
        },
        {
          id: "acc-other",
          name: "Muster-Depot 2",
          type: "brokerage",
          scope: "household",
          balanceCents: 0,
          holdingsValueCents: 400_000,
        },
      ],
      positions: [
        {
          id: "pos-1",
          accountId: "acc-other",
          name: "Muster-ETF",
          symbol: "MSTR",
          isin: null,
          assetClass: "etf",
          marketValueCents: 400_000,
          costBasisCents: null,
          lastPriceAt: null,
        },
      ],
      fetchedAt: "2026-11-19T08:00:00.000Z",
    });

    createPot(
      potCreateSchema.parse({
        name: "Depot-Topf",
        ruleType: "fixed_monthly",
        fixedMonthlyCents: 1,
        externalLink: { kind: "account", ref: "acc-depot" },
      }),
    );
    createPot(
      potCreateSchema.parse({
        name: "ETF-Topf",
        ruleType: "fixed_monthly",
        fixedMonthlyCents: 1,
        externalLink: { kind: "position", ref: "pos-1" },
      }),
    );

    // Position moves into the already-linked account -> link_conflict
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 0,
      accounts: [
        {
          id: "acc-depot",
          name: "Muster-Depot",
          type: "brokerage",
          scope: "household",
          balanceCents: 100_000,
          holdingsValueCents: 400_000,
        },
      ],
      positions: [
        {
          id: "pos-1",
          accountId: "acc-depot",
          name: "Muster-ETF",
          symbol: "MSTR",
          isin: null,
          assetClass: "etf",
          marketValueCents: 400_000,
          costBasisCents: null,
          lastPriceAt: null,
        },
      ],
      fetchedAt: "2026-11-19T09:00:00.000Z",
    });

    const now = new Date("2026-11-19T12:00:00Z");
    const cockpit = loadCockpitData("2026-11-19", now);
    await runBalanceSnapshotJob({ now, trigger: "sync" });

    const rows = listBalanceSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.freeAssetsCents).toBe(cockpit.balance.freeAssetsCents);
    expect(rows[0]?.freeAssetsCents).toBe(500_000);
  });
});
