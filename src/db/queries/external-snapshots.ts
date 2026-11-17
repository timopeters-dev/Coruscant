import crypto from "node:crypto";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { type ExternalSnapshotRow, externalSnapshots } from "@/db/schema";
import {
  type ExternalAccount,
  type ExternalPosition,
  externalAccountSchema,
  externalPositionSchema,
  type FinanzCockpitSummary,
  type HouseholdSummary,
  householdSummarySchema,
} from "@/lib/validation/external";

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

type DbInstance = ReturnType<typeof getDb>;
type SnapshotWriter = Pick<DbInstance, "insert">;

export function insertExternalSnapshot(
  summary: FinanzCockpitSummary,
  writer: SnapshotWriter = getDb(),
): ExternalSnapshotRow {
  const [created] = writer
    .insert(externalSnapshots)
    .values({
      id: crypto.randomUUID(),
      source: summary.source,
      liquidCashCents: summary.liquidCashCents,
      etfStocksCents: summary.etfStocksCents,
      cryptoCents: summary.cryptoCents,
      totalPersonalNetWorthCents: summary.totalPersonalNetWorthCents,
      householdJson: summary.household
        ? JSON.stringify(summary.household)
        : null,
      accountsJson: summary.accounts
        ? JSON.stringify(summary.accounts)
        : null,
      positionsJson: summary.positions
        ? JSON.stringify(summary.positions)
        : null,
      fetchedAt: summary.fetchedAt,
    })
    .returning()
    .all();

  if (!created) {
    throw new Error("Failed to insert external snapshot");
  }
  return created;
}

export function parseSnapshotHousehold(
  snapshot: Pick<ExternalSnapshotRow, "householdJson"> | null | undefined,
): HouseholdSummary | null {
  if (!snapshot?.householdJson) {
    return null;
  }
  try {
    const parsedJson: unknown = JSON.parse(snapshot.householdJson);
    const result = householdSummarySchema.safeParse(parsedJson);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(
  raw: string | null | undefined,
  schema: z.ZodType<T>,
): T[] {
  if (!raw) {
    return [];
  }
  try {
    const parsedJson: unknown = JSON.parse(raw);
    const result = z.array(schema).safeParse(parsedJson);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function parseSnapshotAccounts(
  snapshot: Pick<ExternalSnapshotRow, "accountsJson"> | null | undefined,
): ExternalAccount[] {
  return parseJsonArray(snapshot?.accountsJson, externalAccountSchema);
}

export function parseSnapshotPositions(
  snapshot: Pick<ExternalSnapshotRow, "positionsJson"> | null | undefined,
): ExternalPosition[] {
  return parseJsonArray(snapshot?.positionsJson, externalPositionSchema);
}
