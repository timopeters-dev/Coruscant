import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { balanceSnapshots } from "@/db/schema";
import type { BalanceHistoryPoint } from "@/lib/domain/balance-history";
import {
  listBalanceSnapshots,
  upsertBalanceSnapshot,
} from "./balance-history";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-history-db-"));
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

function makePoint(
  date: string,
  overrides: Partial<BalanceHistoryPoint> = {},
): BalanceHistoryPoint {
  const freeAssetsCents = overrides.freeAssetsCents ?? 1_000_000;
  const propertiesValueCents = overrides.propertiesValueCents ?? 20_000_000;
  const savingsContractsValueCents =
    overrides.savingsContractsValueCents ?? 500_000;
  const boundAssetsCents =
    overrides.boundAssetsCents ??
    propertiesValueCents + savingsContractsValueCents;
  const totalAssetsCents =
    overrides.totalAssetsCents ?? freeAssetsCents + boundAssetsCents;
  const liabilitiesCents = overrides.liabilitiesCents ?? 10_000_000;
  const netWorthCents =
    overrides.netWorthCents ?? totalAssetsCents - liabilitiesCents;

  return {
    date,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
    freeAssetsCents,
    boundAssetsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    hasModeledValues: overrides.hasModeledValues ?? true,
  };
}

describe("balance-history DB queries", () => {
  it("upserts idempotently on the same snapshot_date, preserving row id", () => {
    const first = upsertBalanceSnapshot(makePoint("2026-11-19"), {
      trigger: "sync",
      capturedAt: "2026-11-19T10:00:00.000Z",
    });
    expect(first).toEqual({ action: "inserted" });

    const db = dbModule.getDb();
    const initialRow = db
      .select()
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.snapshotDate, "2026-11-19"))
      .get();
    expect(initialRow).toBeDefined();

    const second = upsertBalanceSnapshot(
      makePoint("2026-11-19", { freeAssetsCents: 1_250_000 }),
      {
        trigger: "scheduler",
        capturedAt: "2026-11-19T22:45:00.000Z",
      },
    );
    expect(second).toEqual({ action: "updated" });

    const updatedRow = db
      .select()
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.snapshotDate, "2026-11-19"))
      .get();
    expect(updatedRow?.id).toBe(initialRow?.id);
    expect(updatedRow?.trigger).toBe("scheduler");
    expect(listBalanceSnapshots()).toHaveLength(1);
    expect(listBalanceSnapshots()[0]?.freeAssetsCents).toBe(1_250_000);
  });

  it("lists multiple days ordered ascending and allows negative net worth", () => {
    upsertBalanceSnapshot(
      makePoint("2026-11-20", {
        freeAssetsCents: 100_000,
        propertiesValueCents: 0,
        savingsContractsValueCents: 0,
        liabilitiesCents: 500_000,
        hasModeledValues: false,
      }),
      { trigger: "startup", capturedAt: "2026-11-20T08:00:00.000Z" },
    );
    upsertBalanceSnapshot(makePoint("2026-11-18"), {
      trigger: "sync",
      capturedAt: "2026-11-18T12:00:00.000Z",
    });

    const list = listBalanceSnapshots();
    expect(list.map((p) => p.date)).toEqual(["2026-11-18", "2026-11-20"]);
    expect(list[1]?.netWorthCents).toBe(-400_000);
    expect(list[1]?.hasModeledValues).toBe(false);
  });

  it("enforces SQLite CHECK constraints on invalid raw inserts", () => {
    dbModule.getDb();
    const sqlite = dbModule.getSqlite();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO balance_snapshots (
            id, snapshot_date, total_assets_cents, liabilities_cents, net_worth_cents,
            free_assets_cents, bound_assets_cents, properties_value_cents,
            savings_contracts_value_cents, has_modeled_values, trigger, captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "bad-1",
          "2026-11-19",
          999, // != free + bound
          0,
          999,
          100,
          200,
          200,
          0,
          1,
          "sync",
          "2026-11-19T10:00:00.000Z",
        ),
    ).toThrow();
  });
});
