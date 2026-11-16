import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type CoruscantDb = BetterSQLite3Database<typeof schema>;

export interface DbClient {
  db: CoruscantDb;
  sqlite: Database.Database;
  dbPath: string;
}

const DEFAULT_DB_PATH = "data/coruscant.db";

const migratedDatabases = new WeakSet<Database.Database>();

export function resolveDatabasePath(customPath?: string): string {
  const raw = customPath ?? process.env.DATABASE_URL ?? DEFAULT_DB_PATH;
  const trimmed = raw.trim();
  const target = trimmed.length > 0 ? trimmed : DEFAULT_DB_PATH;

  if (target === ":memory:") {
    return target;
  }

  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), target);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  return resolved;
}

export function runStartupMigrations(
  db: CoruscantDb,
  sqlite: Database.Database,
  migrationsFolder = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "drizzle",
  ),
): void {
  if (migratedDatabases.has(sqlite)) {
    return;
  }
  migrate(db, { migrationsFolder });
  migratedDatabases.add(sqlite);
}

export function createDbClient(
  customPath?: string,
  migrationsFolder?: string,
): DbClient {
  const dbPath = resolveDatabasePath(customPath);
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");

    const db = drizzle(sqlite, { schema });
    runStartupMigrations(db, sqlite, migrationsFolder);

    return { db, sqlite, dbPath };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

type GlobalDbCache = {
  __coruscantDbClient?: DbClient;
};

const globalForDb = globalThis as unknown as GlobalDbCache;

export function getDbClient(): DbClient {
  const targetPath = resolveDatabasePath();
  const existing = globalForDb.__coruscantDbClient;

  if (existing && existing.dbPath === targetPath && existing.sqlite.open) {
    return existing;
  }

  if (existing && existing.sqlite.open) {
    existing.sqlite.close();
  }

  const client = createDbClient(targetPath);
  globalForDb.__coruscantDbClient = client;
  return client;
}

export function getDb(): CoruscantDb {
  return getDbClient().db;
}

export function getSqlite(): Database.Database {
  return getDbClient().sqlite;
}

export function closeDb(): void {
  const existing = globalForDb.__coruscantDbClient;
  if (existing && existing.sqlite.open) {
    existing.sqlite.close();
  }
  globalForDb.__coruscantDbClient = undefined;
}
