import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient, runStartupMigrations } from "./index";
import {
  appMeta,
  cashflowItems,
  documents,
  externalSnapshots,
  financialContracts,
  potAllocations,
  pots,
  properties,
} from "./schema";

const tempDirs: string[] = [];

function makeTempDbPath(subPath = "coruscant.db"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-db-test-"));
  tempDirs.push(dir);
  return path.join(dir, subPath);
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Database client and startup migrations", () => {
  it("creates missing nested directories, enables WAL & foreign_keys, and runs idempotent migrations", () => {
    const dbPath = makeTempDbPath("nested/dir/test.db");
    const { db, sqlite } = createDbClient(dbPath);

    try {
      expect(fs.existsSync(dbPath)).toBe(true);

      const fk = sqlite.pragma("foreign_keys", { simple: true });
      const journal = sqlite.pragma("journal_mode", { simple: true });
      expect(fk).toBe(1);
      expect(String(journal).toLowerCase()).toBe("wal");

      // Second migration call must be a safe no-op
      expect(() => runStartupMigrations(db, sqlite)).not.toThrow();

      // Verify read/write against app_meta
      const now = new Date().toISOString();
      db.insert(appMeta)
        .values({ key: "test_key", value: "ok", updatedAt: now })
        .run();

      const row = db
        .select()
        .from(appMeta)
        .where(eq(appMeta.key, "test_key"))
        .get();
      expect(row?.value).toBe("ok");
    } finally {
      sqlite.close();
    }
  });

  it("supports :memory: database with foreign_keys = ON", () => {
    const { db, sqlite } = createDbClient(":memory:");
    try {
      const fk = sqlite.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);

      db.insert(appMeta)
        .values({
          key: "mem_key",
          value: "1",
          updatedAt: new Date().toISOString(),
        })
        .run();

      const rows = db.select().from(appMeta).all();
      expect(rows).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  it("closes the SQLite handle when initialization or migration fails", () => {
    const dbPath = makeTempDbPath("failed-migration.db");
    const missingMigrationsDir = path.join(
      os.tmpdir(),
      `nonexistent-drizzle-${Date.now()}`,
    );
    const closeSpy = vi.spyOn(Database.prototype, "close");

    expect(() => createDbClient(dbPath, missingMigrationsDir)).toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("creates all 7 v1 domain tables and enforces foreign key, unique, and check constraints", () => {
    const { db, sqlite } = createDbClient(":memory:");
    const now = "2026-11-16T12:00:00.000Z";

    try {
      db.insert(pots)
        .values({
          id: "pot-reserve",
          name: "Instandhaltung Musterstraße 1",
          priority: 1,
          currentCents: 250_000,
          targetCents: 1_000_000,
          ruleType: "fill_to_target",
          updatedAt: now,
        })
        .run();

      db.insert(properties)
        .values({
          id: "prop-0",
          name: "Immobilie #0 (Musterstraße 1)",
          usage: "owner_occupied",
          purchaseDate: "2022-05-01",
          purchasePriceCents: 35_000_000,
          estimatedValueCents: 38_000_000,
          maintenanceReservePotId: "pot-reserve",
          updatedAt: now,
        })
        .run();

      db.insert(financialContracts)
        .values({
          id: "contract-loan-1",
          name: "Hauskredit Musterbank",
          provider: "Musterbank",
          category: "loan",
          status: "active",
          currentBalanceCents: 24_000_000,
          balanceAsOfDate: "2026-01-01",
          monthlyRateCents: 120_000,
          interestRateBps: 350,
          linkedPropertyId: "prop-0",
          repaymentType: "annuity",
          updatedAt: now,
        })
        .run();

      db.insert(cashflowItems)
        .values({
          id: "cf-loan-1",
          name: "Rate Hauskredit Musterbank",
          direction: "outflow",
          amountCents: 120_000,
          frequency: "monthly",
          source: "contract_linked",
          linkedContractId: "contract-loan-1",
          active: true,
          updatedAt: now,
        })
        .run();

      db.insert(pots)
        .values({
          id: "pot-sondertilgung",
          name: "Sondertilgung",
          priority: 2,
          currentCents: 0,
          targetCents: 500_000,
          ruleType: "percentage_of_remainder",
          remainderPercentage: 50,
          linkedContractId: "contract-loan-1",
          linkedPropertyId: "prop-0",
          updatedAt: now,
        })
        .run();

      db.insert(potAllocations)
        .values({
          id: "alloc-1",
          potId: "pot-reserve",
          amountCents: 50_000,
          sourceLabel: "Monatsüberschuss",
          allocatedAt: now,
        })
        .run();

      db.insert(documents)
        .values({
          id: "doc-1",
          filename: "jahresauszug.pdf",
          storagePath: "2026/doc-1.pdf",
          sha256Hash: "abc123dummyhash",
          status: "verified",
          documentType: "loan_statement",
          documentDate: "2026-01-15",
          issuer: "Musterbank",
          totalAmountCents: 0,
          linkedPropertyId: "prop-0",
          linkedContractId: "contract-loan-1",
          isTaxRelevant: false,
          createdAt: now,
        })
        .run();

      db.insert(externalSnapshots)
        .values({
          id: "snap-1",
          source: "finanz_cockpit",
          liquidCashCents: 500_000,
          etfStocksCents: 2_000_000,
          cryptoCents: 100_000,
          totalPersonalNetWorthCents: 2_600_000,
          fetchedAt: now,
        })
        .run();

      // UNIQUE constraint on documents.sha256_hash
      expect(() =>
        db
          .insert(documents)
          .values({
            id: "doc-2",
            filename: "duplikat.pdf",
            storagePath: "2026/doc-2.pdf",
            sha256Hash: "abc123dummyhash",
            createdAt: now,
          })
          .run(),
      ).toThrow();

      // CHECK constraint: negative amount_cents
      expect(() =>
        db
          .insert(cashflowItems)
          .values({
            id: "cf-neg",
            name: "Ungültig",
            direction: "inflow",
            amountCents: -1,
            frequency: "monthly",
            updatedAt: now,
          })
          .run(),
      ).toThrow();

      // CHECK constraint: remainder_percentage > 100
      expect(() =>
        db
          .insert(pots)
          .values({
            id: "pot-invalid-pct",
            name: "Ungültig",
            priority: 99,
            ruleType: "percentage_of_remainder",
            remainderPercentage: 101,
            updatedAt: now,
          })
          .run(),
      ).toThrow();

      // FK cascade & set null on financial_contracts delete
      db.delete(financialContracts)
        .where(eq(financialContracts.id, "contract-loan-1"))
        .run();

      expect(
        db
          .select()
          .from(cashflowItems)
          .where(eq(cashflowItems.id, "cf-loan-1"))
          .all(),
      ).toHaveLength(0);

      const potAfterContractDelete = db
        .select()
        .from(pots)
        .where(eq(pots.id, "pot-sondertilgung"))
        .get();
      expect(potAfterContractDelete?.linkedContractId).toBeNull();

      const docAfterContractDelete = db
        .select()
        .from(documents)
        .where(eq(documents.id, "doc-1"))
        .get();
      expect(docAfterContractDelete?.linkedContractId).toBeNull();

      // FK cascade & set null on pots delete
      db.delete(pots).where(eq(pots.id, "pot-reserve")).run();

      expect(
        db
          .select()
          .from(potAllocations)
          .where(eq(potAllocations.id, "alloc-1"))
          .all(),
      ).toHaveLength(0);

      const propAfterPotDelete = db
        .select()
        .from(properties)
        .where(eq(properties.id, "prop-0"))
        .get();
      expect(propAfterPotDelete?.maintenanceReservePotId).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("preserves linked_property_id on financial_contracts, pots, and documents when migrating from 0001 to 0002", () => {
    const dbPath = makeTempDbPath("upgrade-0001-to-0002.db");
    const sourceDrizzleDir = path.resolve(process.cwd(), "drizzle");
    const tempDrizzleDir = path.join(path.dirname(dbPath), "drizzle-0001");
    fs.mkdirSync(path.join(tempDrizzleDir, "meta"), { recursive: true });

    fs.copyFileSync(
      path.join(sourceDrizzleDir, "0000_greedy_dagger.sql"),
      path.join(tempDrizzleDir, "0000_greedy_dagger.sql"),
    );
    fs.copyFileSync(
      path.join(sourceDrizzleDir, "0001_cool_bloodscream.sql"),
      path.join(tempDrizzleDir, "0001_cool_bloodscream.sql"),
    );

    const fullJournal = JSON.parse(
      fs.readFileSync(
        path.join(sourceDrizzleDir, "meta/_journal.json"),
        "utf-8",
      ),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    fs.writeFileSync(
      path.join(tempDrizzleDir, "meta/_journal.json"),
      JSON.stringify({
        ...fullJournal,
        entries: fullJournal.entries.filter((entry) => entry.idx <= 1),
      }),
    );

    const now = "2026-11-16T12:00:00.000Z";
    const initialClient = createDbClient(dbPath, tempDrizzleDir);
    try {
      initialClient.sqlite
        .prepare(
          `INSERT INTO properties (id, name, usage, estimated_value_cents, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("prop-upgrade", "Musterhaus Upgrade", "owner_occupied", 45000000, now);

      initialClient.sqlite
        .prepare(
          `INSERT INTO financial_contracts (id, name, sphere, category, status, current_balance_cents, balance_as_of_date, monthly_rate_cents, interest_rate_bps, linked_property_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "contract-upgrade",
          "Musterkredit",
          "household",
          "loan",
          "active",
          25000000,
          "2026-11-01",
          120000,
          350,
          "prop-upgrade",
          now,
        );

      initialClient.sqlite
        .prepare(
          `INSERT INTO pots (id, name, priority, current_cents, rule_type, linked_property_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "pot-upgrade",
          "Instandhaltung",
          1,
          500000,
          "fixed_monthly",
          "prop-upgrade",
          now,
        );

      initialClient.sqlite
        .prepare(
          `INSERT INTO documents (id, filename, storage_path, sha256_hash, status, document_type, linked_property_id, is_tax_relevant, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "doc-upgrade",
          "kaufvertrag.pdf",
          "2026/00000000-0000-0000-0000-000000000001.pdf",
          "hash-upgrade-1",
          "verified",
          "contract",
          "prop-upgrade",
          0,
          now,
        );
    } finally {
      initialClient.sqlite.close();
    }

    // Now open with full drizzle/ folder (runs 0002_romantic_whiplash.sql)
    const upgradedClient = createDbClient(dbPath);
    try {
      expect(
        upgradedClient.sqlite.pragma("foreign_keys", { simple: true }),
      ).toBe(1);

      const contractRow = upgradedClient.db
        .select()
        .from(financialContracts)
        .where(eq(financialContracts.id, "contract-upgrade"))
        .get();
      expect(contractRow?.linkedPropertyId).toBe("prop-upgrade");

      const potRow = upgradedClient.db
        .select()
        .from(pots)
        .where(eq(pots.id, "pot-upgrade"))
        .get();
      expect(potRow?.linkedPropertyId).toBe("prop-upgrade");
      expect(potRow?.targetDate).toBeNull();

      const docRow = upgradedClient.db
        .select()
        .from(documents)
        .where(eq(documents.id, "doc-upgrade"))
        .get();
      expect(docRow?.linkedPropertyId).toBe("prop-upgrade");

      const propRow = upgradedClient.db
        .select()
        .from(properties)
        .where(eq(properties.id, "prop-upgrade"))
        .get();
      expect(propRow?.name).toBe("Musterhaus Upgrade");
      expect(propRow?.street).toBeNull();
    } finally {
      upgradedClient.sqlite.close();
    }
  });

  it("includes monthly_maintenance_allowance_cents after migration 0008 and sets maintenance_reserve_pot_id to null on pot delete", () => {
    const { db, sqlite } = createDbClient(":memory:");
    try {
      const cols = sqlite
        .prepare("PRAGMA table_info('properties')")
        .all() as { name: string }[];
      expect(cols.some((c) => c.name === "monthly_maintenance_allowance_cents")).toBe(
        true,
      );

      const now = new Date().toISOString();
      db.insert(pots)
        .values({
          id: "pot-maint-1",
          name: "Instandhaltung Musterstraße",
          priority: 1,
          currentCents: 100_000,
          ruleType: "fill_to_target",
          targetCents: 500_000,
          updatedAt: now,
        })
        .run();

      db.insert(properties)
        .values({
          id: "prop-rented-1",
          name: "Wohnung Musterstraße 1",
          usage: "rented",
          estimatedValueCents: 25_000_000,
          maintenanceReservePotId: "pot-maint-1",
          monthlyColdRentCents: 80_000,
          monthlyNonRecoverableCostsCents: 6_000,
          monthlyMaintenanceAllowanceCents: 5_000,
          updatedAt: now,
        })
        .run();

      const inserted = db
        .select()
        .from(properties)
        .where(eq(properties.id, "prop-rented-1"))
        .get();
      expect(inserted?.monthlyMaintenanceAllowanceCents).toBe(5_000);
      expect(inserted?.maintenanceReservePotId).toBe("pot-maint-1");

      db.delete(pots).where(eq(pots.id, "pot-maint-1")).run();

      const afterDelete = db
        .select()
        .from(properties)
        .where(eq(properties.id, "prop-rented-1"))
        .get();
      expect(afterDelete?.maintenanceReservePotId).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  describe("migration 0012_household_only", () => {
    function buildDirUpTo11(dbPath: string): string {
      const sourceDrizzleDir = path.resolve(process.cwd(), "drizzle");
      const tempDrizzleDir = path.join(path.dirname(dbPath), "drizzle-0011");
      fs.mkdirSync(path.join(tempDrizzleDir, "meta"), { recursive: true });
      const fullJournal = JSON.parse(
        fs.readFileSync(path.join(sourceDrizzleDir, "meta/_journal.json"), "utf-8"),
      ) as { entries: Array<{ idx: number; tag: string }> };
      const kept = fullJournal.entries.filter((entry) => entry.idx <= 11);
      for (const entry of kept) {
        fs.copyFileSync(
          path.join(sourceDrizzleDir, `${entry.tag}.sql`),
          path.join(tempDrizzleDir, `${entry.tag}.sql`),
        );
      }
      fs.writeFileSync(
        path.join(tempDrizzleDir, "meta/_journal.json"),
        JSON.stringify({ ...fullJournal, entries: kept }),
      );
      return tempDrizzleDir;
    }

    const insertContract = (
      sqlite: Database.Database,
      id: string,
      sphere: string,
      category: string,
    ) =>
      sqlite
        .prepare(
          `INSERT INTO financial_contracts (id, name, provider, sphere, category, status, current_balance_cents, balance_as_of_date, monthly_rate_cents, interest_rate_bps, updated_at)
           VALUES (?, ?, 'Musterbank', ?, ?, 'active', 1234500, '2026-11-01', 5000, 250, '2026-11-02T10:00:00.000Z')`,
        )
        .run(id, `Vertrag ${id}`, sphere, category);

    it("moves personal contracts to household without touching any other column, and is idempotent", () => {
      const dbPath = makeTempDbPath("household-only.db");
      const oldDir = buildDirUpTo11(dbPath);
      const oldClient = createDbClient(dbPath, oldDir);
      let before: Array<Record<string, unknown>>;
      try {
        insertContract(oldClient.sqlite, "c-personal", "personal", "loan");
        insertContract(oldClient.sqlite, "c-household", "household", "savings_contract");
        before = oldClient.sqlite
          .prepare("SELECT * FROM financial_contracts ORDER BY id")
          .all() as Array<Record<string, unknown>>;
      } finally {
        oldClient.sqlite.close();
      }

      const expected = before.map((row) => ({ ...row, sphere: "household" }));
      for (let run = 0; run < 2; run += 1) {
        const client = createDbClient(dbPath);
        try {
          const rows = client.sqlite
            .prepare("SELECT * FROM financial_contracts ORDER BY id")
            .all();
          expect(rows).toMatchObject(expected);
        } finally {
          client.sqlite.close();
        }
      }
    });

    it("runs without error on an empty table", () => {
      const dbPath = makeTempDbPath("household-only-empty.db");
      const oldClient = createDbClient(dbPath, buildDirUpTo11(dbPath));
      oldClient.sqlite.close();
      const client = createDbClient(dbPath);
      try {
        expect(
          client.sqlite.prepare("SELECT COUNT(*) AS n FROM financial_contracts").get(),
        ).toEqual({ n: 0 });
      } finally {
        client.sqlite.close();
      }
    });
  });

  describe("migration 0014_loan_options", () => {
    function buildDirUpTo13(dbPath: string): string {
      const sourceDrizzleDir = path.resolve(process.cwd(), "drizzle");
      const tempDrizzleDir = path.join(path.dirname(dbPath), "drizzle-0013");
      fs.mkdirSync(path.join(tempDrizzleDir, "meta"), { recursive: true });
      const fullJournal = JSON.parse(
        fs.readFileSync(path.join(sourceDrizzleDir, "meta/_journal.json"), "utf-8"),
      ) as { entries: Array<{ idx: number; tag: string }> };
      const kept = fullJournal.entries.filter((entry) => entry.idx <= 13);
      for (const entry of kept) {
        fs.copyFileSync(
          path.join(sourceDrizzleDir, `${entry.tag}.sql`),
          path.join(tempDrizzleDir, `${entry.tag}.sql`),
        );
      }
      fs.writeFileSync(
        path.join(tempDrizzleDir, "meta/_journal.json"),
        JSON.stringify({ ...fullJournal, entries: kept }),
      );
      return tempDrizzleDir;
    }

    it("backfills special_repayment_right/basis for NULL, 0, >0 loans and savings contracts while preserving FKs", () => {
      const dbPath = makeTempDbPath("loan-options-backfill.db");
      const oldDir = buildDirUpTo13(dbPath);
      const oldClient = createDbClient(dbPath, oldDir);
      const now = "2026-11-19T10:00:00.000Z";
      try {
        const insertStmt = oldClient.sqlite.prepare(
          `INSERT INTO financial_contracts (
             id, name, provider, sphere, category, status,
             current_balance_cents, balance_as_of_date, monthly_rate_cents,
             interest_rate_bps, repayment_type, special_repayment_max_yearly_cents, updated_at
           ) VALUES (?, ?, 'Musterbank', 'household', ?, 'active', 20000000, '2026-01-01', 100000, 350, ?, ?, ?)`,
        );
        insertStmt.run("loan-null", "Kredit Unbekannt", "loan", "annuity", null, now);
        insertStmt.run("loan-zero", "Kredit Keine", "loan", "annuity", 0, now);
        insertStmt.run("loan-cap", "Kredit Deckel", "loan", "annuity", 1_200_000, now);
        insertStmt.run("savings-1", "Bausparer Muster", "savings_contract", null, null, now);

        oldClient.sqlite
          .prepare(
            `INSERT INTO cashflow_items (id, name, direction, amount_cents, frequency, source, linked_contract_id, active, updated_at)
             VALUES ('cf-loan-cap', 'Rate', 'outflow', 100000, 'monthly', 'contract_linked', 'loan-cap', 1, ?)`,
          )
          .run(now);
      } finally {
        oldClient.sqlite.close();
      }

      const upgraded = createDbClient(dbPath);
      try {
        expect(upgraded.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

        const byId = new Map(
          upgraded.db
            .select()
            .from(financialContracts)
            .all()
            .map((r) => [r.id, r]),
        );

        const loanNull = byId.get("loan-null")!;
        expect(loanNull.specialRepaymentRight).toBe("unknown");
        expect(loanNull.specialRepaymentBasis).toBeNull();
        expect(loanNull.specialRepaymentMaxYearlyCents).toBeNull();
        expect(loanNull.rateChangeRight).toBe("unknown");
        expect(loanNull.rateChangeUsedCount).toBe(0);

        const loanZero = byId.get("loan-zero")!;
        expect(loanZero.specialRepaymentRight).toBe("none");
        expect(loanZero.specialRepaymentBasis).toBeNull();
        expect(loanZero.specialRepaymentMaxYearlyCents).toBeNull();

        const loanCap = byId.get("loan-cap")!;
        expect(loanCap.specialRepaymentRight).toBe("allowed");
        expect(loanCap.specialRepaymentBasis).toBe("fixed_yearly");
        expect(loanCap.specialRepaymentMaxYearlyCents).toBe(1_200_000);

        const savings = byId.get("savings-1")!;
        expect(savings.specialRepaymentRight).toBe("unknown");
        expect(savings.specialRepaymentBasis).toBeNull();

        // Linked cashflow item still intact
        const cf = upgraded.db
          .select()
          .from(cashflowItems)
          .where(eq(cashflowItems.id, "cf-loan-cap"))
          .get();
        expect(cf?.linkedContractId).toBe("loan-cap");
      } finally {
        upgraded.sqlite.close();
      }
    });

    it("enforces CHECK constraints on new loan option columns", () => {
      const { db, sqlite } = createDbClient(":memory:");
      const now = "2026-11-19T10:00:00.000Z";
      const base = {
        name: "Musterkredit",
        category: "loan" as const,
        currentBalanceCents: 10_000_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 100_000,
        interestRateBps: 300,
        updatedAt: now,
      };
      try {
        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-orig", originalPrincipalCents: 0 })
            .run(),
        ).toThrow();

        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-pct-0", specialRepaymentPercentBps: 0 })
            .run(),
        ).toThrow();

        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-pct-hi", specialRepaymentPercentBps: 10001 })
            .run(),
        ).toThrow();

        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-used-pair", specialRepaymentUsedCents: 50_000 })
            .run(),
        ).toThrow();

        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-rc-count", rateChangeTotalCount: 51 })
            .run(),
        ).toThrow();

        expect(() =>
          db
            .insert(financialContracts)
            .values({ ...base, id: "bad-rc-used", rateChangeUsedCount: -1 })
            .run(),
        ).toThrow();
      } finally {
        sqlite.close();
      }
    });
  });
});
