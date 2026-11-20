import crypto from "node:crypto";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import {
  properties,
  propertyValuationHistory,
  valuationProviderQuota,
  type PropertyRow,
  type PropertyValuationHistoryRow,
} from "@/backend/db/schema";
import type {
  AutoValuationInterval,
  QuotaSnapshot,
} from "@/domain/properties/valuation/auto-schedule";
import {
  computeValuationDeviationBps,
  isDeviationAboveThreshold,
  type PropertyValuation,
  type ValuationWarning,
} from "@/domain/properties/valuation/valuation";
import {
  applyValuationAdjustment,
  parseValuationAdjustments,
  serializeValuationAdjustments,
  sumAdjustmentBps,
  type ValuationAdjustment,
} from "@/domain/properties/valuation/adjustments";
import {
  planAdjustmentRecompute,
  type PlanAdjustmentRecomputeResult,
} from "@/domain/properties/valuation/adjustment-recompute";
import type { ValuationChoice } from "@/domain/properties/valuation/adoption";
import {
  decideValuationWrite,
  type ValuationTrigger,
  type ValuationWriteDecision,
} from "@/domain/properties/valuation/write-decision";
import { toBerlinDateKey } from "@/backend/jobs/berlin-clock";

export type AutoValuationOutcome = NonNullable<
  PropertyRow["lastAutoValuationOutcome"]
>;

export class ValuationHistoryNotFoundError extends Error {
  constructor(message = "Bewertungseintrag nicht gefunden.") {
    super(message);
    this.name = "ValuationHistoryNotFoundError";
  }
}

export class PropertyNotFoundError extends Error {
  constructor(message = "Immobilie nicht gefunden.") {
    super(message);
    this.name = "PropertyNotFoundError";
  }
}

export class ValuationValueConflictError extends Error {
  readonly currentValueCents: number;
  constructor(currentValueCents: number) {
    super("Der Objektwert hat sich zwischenzeitlich geändert.");
    this.name = "ValuationValueConflictError";
    this.currentValueCents = currentValueCents;
  }
}

export interface AutoValuationCandidateRow {
  id: string;
  interval: AutoValuationInterval;
  lastAutoValuationAt: string | null;
  lastAutoValuationAttemptAt: string | null;
}

export function listAutoValuationCandidates(): AutoValuationCandidateRow[] {
  const db = getDb();
  const rows = db
    .select({
      id: properties.id,
      interval: properties.autoValuationInterval,
      lastAutoValuationAt: properties.lastAutoValuationAt,
      lastAutoValuationAttemptAt: properties.lastAutoValuationAttemptAt,
    })
    .from(properties)
    .where(ne(properties.autoValuationInterval, "off"))
    .all();

  return rows;
}

export function listAllPropertyIntervals(): AutoValuationInterval[] {
  const db = getDb();
  return db
    .select({ interval: properties.autoValuationInterval })
    .from(properties)
    .all()
    .map((row) => row.interval);
}

export function markAutoValuationAttempt(id: string, nowIso: string): void {
  const db = getDb();
  db.update(properties)
    .set({
      lastAutoValuationAttemptAt: nowIso,
    })
    .where(eq(properties.id, id))
    .run();
}

export interface RecordValuationOutcomeInput {
  propertyId: string;
  trigger: ValuationTrigger;
  valuation: PropertyValuation | null;
  decision: ValuationWriteDecision | null;
  outcome: AutoValuationOutcome | null;
  nowIso: string;
  markDone: boolean;
}

export interface RecordValuationOutcomeResult {
  historyId: string | null;
  decision: ValuationWriteDecision | null;
}

export function recordValuationOutcome(
  input: RecordValuationOutcomeInput,
): RecordValuationOutcomeResult | null {
  const db = getDb();
  return db.transaction((tx) => {
    const current = tx
      .select({
        id: properties.id,
        estimatedValueCents: properties.estimatedValueCents,
        estimatedValueSource: properties.estimatedValueSource,
        valuationAdjustments: properties.valuationAdjustments,
      })
      .from(properties)
      .where(eq(properties.id, input.propertyId))
      .get();

    if (!current) {
      return null;
    }

    let historyId: string | null = null;
    let effectiveDecision = input.decision;
    let effectiveOutcome = input.outcome;
    const currentAdjustments = parseValuationAdjustments(
      current.valuationAdjustments,
    );
    const adjustmentBps = sumAdjustmentBps(currentAdjustments);
    const adjustmentsJson = serializeValuationAdjustments(currentAdjustments);
    const adjustedMedianCents =
      input.valuation !== null
        ? applyValuationAdjustment(input.valuation.medianCents, adjustmentBps)
        : null;

    if (input.valuation !== null && adjustedMedianCents !== null) {
      const deviationBps = computeValuationDeviationBps(
        adjustedMedianCents,
        current.estimatedValueCents,
      );
      const freshWarnings: ValuationWarning[] =
        deviationBps !== null && isDeviationAboveThreshold(deviationBps)
          ? [{ code: "deviates_from_current", deviationBps }]
          : [];
      effectiveDecision = decideValuationWrite({
        trigger: input.trigger,
        currentSource: current.estimatedValueSource,
        currentValueCents: current.estimatedValueCents,
        warnings: freshWarnings,
      });
      if (
        input.outcome === "written" ||
        input.outcome === "history_only"
      ) {
        effectiveOutcome =
          effectiveDecision.action === "write" ? "written" : "history_only";
      }
    }

    const isWrite = effectiveDecision?.action === "write";

    if (input.valuation !== null) {
      historyId = crypto.randomUUID();
      tx.insert(propertyValuationHistory)
        .values({
          id: historyId,
          propertyId: input.propertyId,
          valuedAt: input.nowIso,
          dataAsOf: input.valuation.asOfDate,
          lowerCents: input.valuation.lowerCents,
          medianCents: input.valuation.medianCents,
          upperCents: input.valuation.upperCents,
          confidence: input.valuation.confidence,
          confidenceScore: input.valuation.confidenceScore,
          valuability: input.valuation.valuability,
          source: "immoanalyse",
          trigger: input.trigger,
          requestId: input.valuation.requestId,
          appliedAt: isWrite ? input.nowIso : null,
          previousValueCents: isWrite ? current.estimatedValueCents : null,
          adjustmentBps,
          adjustmentsJson,
          appliedChoice: isWrite ? "median" : null,
        })
        .run();
    }

    const patch: Partial<typeof properties.$inferInsert> = {};
    if (isWrite && input.valuation !== null && adjustedMedianCents !== null) {
      patch.estimatedValueCents = adjustedMedianCents;
      patch.estimatedValueAsOf = input.valuation.asOfDate;
      patch.estimatedValueSource = "immoanalyse";
      patch.updatedAt = input.nowIso;
    }
    if (input.markDone) {
      patch.lastAutoValuationAt = input.nowIso;
    }
    if (input.trigger === "auto" && effectiveOutcome !== null) {
      patch.lastAutoValuationOutcome = effectiveOutcome;
    }

    if (Object.keys(patch).length > 0) {
      tx.update(properties)
        .set(patch)
        .where(eq(properties.id, input.propertyId))
        .run();
    }

    return {
      historyId,
      decision: effectiveDecision,
    };
  });
}

function pickChoiceCents(
  entry: PropertyValuationHistoryRow,
  choice: ValuationChoice,
): number {
  switch (choice) {
    case "lower":
      return entry.lowerCents;
    case "median":
      return entry.medianCents;
    case "upper":
      return entry.upperCents;
  }
}

export function adoptValuationHistoryEntry(
  propertyId: string,
  historyId: string,
  choice: ValuationChoice,
  nowIso: string = new Date().toISOString(),
): PropertyRow {
  const db = getDb();
  return db.transaction((tx) => {
    const entry = tx
      .select()
      .from(propertyValuationHistory)
      .where(
        and(
          eq(propertyValuationHistory.id, historyId),
          eq(propertyValuationHistory.propertyId, propertyId),
          eq(propertyValuationHistory.source, "immoanalyse"),
        ),
      )
      .get();

    if (!entry) {
      throw new ValuationHistoryNotFoundError();
    }

    const current = tx
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .get();

    if (!current) {
      throw new ValuationHistoryNotFoundError();
    }

    const currentAdjustments = parseValuationAdjustments(
      current.valuationAdjustments,
    );
    const adjustmentBps = sumAdjustmentBps(currentAdjustments);
    const adjustmentsJson = serializeValuationAdjustments(currentAdjustments);
    const baseChosenCents = pickChoiceCents(entry, choice);
    const chosenCents = applyValuationAdjustment(baseChosenCents, adjustmentBps);
    const asOf = entry.dataAsOf ?? toBerlinDateKey(entry.valuedAt);

    if (
      entry.appliedAt !== null &&
      current.estimatedValueCents === chosenCents &&
      current.estimatedValueSource === "immoanalyse"
    ) {
      const [touched] = tx
        .update(properties)
        .set({ updatedAt: nowIso })
        .where(eq(properties.id, propertyId))
        .returning()
        .all();
      return touched ?? current;
    }

    const [updatedProperty] = tx
      .update(properties)
      .set({
        estimatedValueCents: chosenCents,
        estimatedValueAsOf: asOf,
        estimatedValueSource: "immoanalyse",
        updatedAt: nowIso,
      })
      .where(eq(properties.id, propertyId))
      .returning()
      .all();

    tx.update(propertyValuationHistory)
      .set({
        appliedAt: nowIso,
        previousValueCents: current.estimatedValueCents,
        appliedChoice: choice,
        adjustmentBps,
        adjustmentsJson,
      })
      .where(eq(propertyValuationHistory.id, historyId))
      .run();

    if (!updatedProperty) {
      throw new ValuationHistoryNotFoundError();
    }
    return updatedProperty;
  });
}

export function listValuationHistory(
  propertyId: string,
  limit = 120,
): PropertyValuationHistoryRow[] {
  const db = getDb();
  return db
    .select()
    .from(propertyValuationHistory)
    .where(eq(propertyValuationHistory.propertyId, propertyId))
    .orderBy(desc(propertyValuationHistory.valuedAt))
    .limit(limit)
    .all()
    .reverse();
}

/**
 * Entfernt genau einen Verlaufseintrag (z. B. versehentlich erfasster Wert).
 * Der aktuelle Objektwert der Immobilie bleibt bewusst unverändert – er wird
 * bei Bedarf separat im Objekt korrigiert.
 */
export function deleteValuationHistoryEntry(
  propertyId: string,
  historyId: string,
): void {
  const db = getDb();
  const result = db
    .delete(propertyValuationHistory)
    .where(
      and(
        eq(propertyValuationHistory.id, historyId),
        eq(propertyValuationHistory.propertyId, propertyId),
      ),
    )
    .run();

  if (result.changes === 0) {
    throw new ValuationHistoryNotFoundError();
  }
}

export function getLatestPendingSuggestion(
  propertyId: string,
): PropertyValuationHistoryRow | null {
  const db = getDb();
  const latest = db
    .select()
    .from(propertyValuationHistory)
    .where(
      and(
        eq(propertyValuationHistory.propertyId, propertyId),
        ne(propertyValuationHistory.trigger, "adjustment"),
      ),
    )
    .orderBy(desc(propertyValuationHistory.valuedAt))
    .limit(1)
    .get();

  if (!latest) {
    return null;
  }
  if (latest.source === "immoanalyse" && latest.appliedAt === null) {
    return latest;
  }
  return null;
}

export interface SaveValuationAdjustmentsResult {
  property: PropertyRow;
  adjustments: ValuationAdjustment[];
  totalBps: number;
  recompute: { fromCents: number; toCents: number } | null;
  reason:
    | Extract<PlanAdjustmentRecomputeResult, { action: "none" }>["reason"]
    | null;
}

export function saveValuationAdjustments(
  propertyId: string,
  list: readonly ValuationAdjustment[],
  options?: {
    expectedEstimatedValueCents?: number;
    nowIso?: string;
  },
): SaveValuationAdjustmentsResult {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const db = getDb();

  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .get();

    if (!current) {
      throw new PropertyNotFoundError();
    }

    if (
      options?.expectedEstimatedValueCents !== undefined &&
      options.expectedEstimatedValueCents !== current.estimatedValueCents
    ) {
      throw new ValuationValueConflictError(current.estimatedValueCents);
    }

    const serialized = serializeValuationAdjustments(list);
    const normalized = parseValuationAdjustments(serialized);
    const newTotalBps = sumAdjustmentBps(normalized);

    const [afterAdjustmentsWrite] = tx
      .update(properties)
      .set({
        valuationAdjustments: serialized,
        updatedAt: nowIso,
      })
      .where(eq(properties.id, propertyId))
      .returning()
      .all();

    const latestApplied = tx
      .select()
      .from(propertyValuationHistory)
      .where(
        and(
          eq(propertyValuationHistory.propertyId, propertyId),
          eq(propertyValuationHistory.source, "immoanalyse"),
          isNotNull(propertyValuationHistory.appliedAt),
        ),
      )
      .orderBy(
        desc(propertyValuationHistory.appliedAt),
        desc(propertyValuationHistory.valuedAt),
      )
      .limit(1)
      .get();

    const plan = planAdjustmentRecompute({
      currentSource: current.estimatedValueSource,
      currentValueCents: current.estimatedValueCents,
      appliedEntry: latestApplied ?? null,
      newTotalBps,
    });

    if (plan.action === "recompute" && latestApplied) {
      const [updatedProperty] = tx
        .update(properties)
        .set({
          estimatedValueCents: plan.toCents,
          estimatedValueSource: "immoanalyse",
          estimatedValueAsOf:
            latestApplied.dataAsOf ?? current.estimatedValueAsOf,
          updatedAt: nowIso,
        })
        .where(eq(properties.id, propertyId))
        .returning()
        .all();

      tx.insert(propertyValuationHistory)
        .values({
          id: crypto.randomUUID(),
          propertyId,
          valuedAt: nowIso,
          dataAsOf: latestApplied.dataAsOf,
          lowerCents: latestApplied.lowerCents,
          medianCents: latestApplied.medianCents,
          upperCents: latestApplied.upperCents,
          confidence: latestApplied.confidence,
          confidenceScore: latestApplied.confidenceScore,
          valuability: latestApplied.valuability,
          source: "immoanalyse",
          trigger: "adjustment",
          requestId: latestApplied.requestId,
          appliedAt: nowIso,
          previousValueCents: plan.fromCents,
          adjustmentBps: newTotalBps,
          adjustmentsJson: serialized,
          appliedChoice: plan.choice,
        })
        .run();

      return {
        property: updatedProperty ?? afterAdjustmentsWrite ?? current,
        adjustments: normalized,
        totalBps: newTotalBps,
        recompute: { fromCents: plan.fromCents, toCents: plan.toCents },
        reason: null,
      };
    }

    return {
      property: afterAdjustmentsWrite ?? current,
      adjustments: normalized,
      totalBps: newTotalBps,
      recompute: null,
      reason: plan.action === "none" ? plan.reason : null,
    };
  });
}

export function getQuotaSnapshot(
  provider: "immoanalyse" = "immoanalyse",
): QuotaSnapshot | null {
  const db = getDb();
  const row = db
    .select()
    .from(valuationProviderQuota)
    .where(eq(valuationProviderQuota.provider, provider))
    .get();

  if (!row) {
    return null;
  }

  return {
    limit: row.limitCount,
    used: row.usedCount,
    remaining: row.remainingCount,
    resetAt: row.resetAt,
    tariff: row.tariff,
    observedAt: row.observedAt,
  };
}

export function upsertQuotaSnapshot(
  snapshot: QuotaSnapshot,
  nowIso: string = new Date().toISOString(),
  provider: "immoanalyse" = "immoanalyse",
): void {
  const db = getDb();
  db.insert(valuationProviderQuota)
    .values({
      provider,
      limitCount: snapshot.limit,
      usedCount: snapshot.used,
      remainingCount: snapshot.remaining,
      resetAt: snapshot.resetAt,
      tariff: snapshot.tariff,
      observedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: valuationProviderQuota.provider,
      set: {
        limitCount: snapshot.limit,
        usedCount: snapshot.used,
        remainingCount: snapshot.remaining,
        resetAt: snapshot.resetAt,
        tariff: snapshot.tariff,
        observedAt: nowIso,
      },
    })
    .run();
}
