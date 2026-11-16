import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient, runStartupMigrations } from "./index";
import { appMeta } from "./schema";

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
});
