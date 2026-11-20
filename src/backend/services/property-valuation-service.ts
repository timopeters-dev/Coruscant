import { loadPropertyValuationSource } from "@/backend/db/queries/contracts";
import {
  recordValuationOutcome,
  upsertQuotaSnapshot,
} from "@/backend/db/queries/property-valuations";
import type { QuotaSnapshot } from "@/domain/properties/valuation/auto-schedule";
import {
  validatePropertyValuation,
  type PropertyValuation,
  type ValuationRejectReason,
  type ValuationWarning,
} from "@/domain/properties/valuation/valuation";
import { sumAdjustmentBps } from "@/domain/properties/valuation/adjustments";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  ValuationContextPiiError,
  type ValuationContextUnavailableReason,
} from "@/domain/properties/valuation/context";
import {
  decideValuationWrite,
  type ValuationTrigger,
  type ValuationWriteDecision,
} from "@/domain/properties/valuation/write-decision";
import {
  assertRequestHasNoAddress,
  buildImmoAnalyseRequest,
  serializeImmoAnalyseRequest,
} from "@/backend/integrations/immoanalyse-mapping";
import {
  createDefaultPropertyValuator,
  type PropertyValuator,
  type ValuatorErrorCode,
} from "@/backend/integrations/property-valuator";
import { getBerlinClockSnapshot } from "@/backend/jobs/berlin-clock";

export type RunPropertyValuationResult =
  | {
      kind: "ok";
      valuation: PropertyValuation;
      warnings: ValuationWarning[];
      decision: ValuationWriteDecision;
      historyId: string | null;
      requestJson: string;
      cached: boolean;
      quota: QuotaSnapshot | null;
    }
  | {
      kind: "error";
      code:
        | "not_found"
        | "unavailable"
        | "unsafe"
        | "valuation_rejected"
        | ValuatorErrorCode;
      message: string;
      reason?: ValuationContextUnavailableReason | ValuationRejectReason;
      rationale?: string;
      httpStatus?: number;
      apiCode?: string;
      quota?: QuotaSnapshot | null;
    };

export interface RunPropertyValuationOptions {
  trigger: ValuationTrigger;
  valuator?: PropertyValuator;
  nowFn?: () => Date;
}

export async function runPropertyValuation(
  propertyId: string,
  options: RunPropertyValuationOptions,
): Promise<RunPropertyValuationResult> {
  const getNow = options.nowFn ?? (() => new Date());
  const startNow = getNow();
  const startNowIso = startNow.toISOString();
  const todayKey = getBerlinClockSnapshot(startNow).dateKey;

  const source = loadPropertyValuationSource(propertyId, todayKey);
  if (!source) {
    return {
      kind: "error",
      code: "not_found",
      message: "Immobilie nicht gefunden.",
    };
  }

  const built = buildPropertyValuationContext(source.contextInput);
  if (!built.ok) {
    if (options.trigger === "auto") {
      recordValuationOutcome({
        propertyId,
        trigger: "auto",
        valuation: null,
        decision: null,
        outcome: "not_valuable",
        nowIso: startNowIso,
        markDone: false,
      });
    }
    return {
      kind: "error",
      code: "unavailable",
      reason: built.reason,
      message: "Objektkontext für die Wertschätzung unvollständig.",
    };
  }

  let requestJson: string;
  try {
    assertValuationContextSafe(built.context, source.contextInput.forbiddenTerms);
    const body = buildImmoAnalyseRequest(built.context);
    assertRequestHasNoAddress(body);
    requestJson = serializeImmoAnalyseRequest(body);
  } catch (error) {
    if (error instanceof ValuationContextPiiError) {
      return {
        kind: "error",
        code: "unsafe",
        message: "Kontext enthält potenziell personenbezogene Daten.",
      };
    }
    throw error;
  }

  const valuator = options.valuator ?? createDefaultPropertyValuator(todayKey);
  const estimateResult = await valuator.estimate(requestJson);
  const completedAtIso = getNow().toISOString();

  if (estimateResult.quota) {
    upsertQuotaSnapshot(estimateResult.quota, completedAtIso);
  }

  if (!estimateResult.ok) {
    if (options.trigger === "auto") {
      if (estimateResult.code === "not_valuable") {
        recordValuationOutcome({
          propertyId,
          trigger: "auto",
          valuation: null,
          decision: null,
          outcome: "not_valuable",
          nowIso: completedAtIso,
          markDone: true,
        });
      } else if (
        estimateResult.code !== "unauthorized" &&
        estimateResult.code !== "quota_exceeded"
      ) {
        recordValuationOutcome({
          propertyId,
          trigger: "auto",
          valuation: null,
          decision: null,
          outcome: "error",
          nowIso: completedAtIso,
          markDone: false,
        });
      }
    }

    return {
      kind: "error",
      code: estimateResult.code,
      message: estimateResult.message,
      httpStatus: estimateResult.httpStatus,
      apiCode: estimateResult.apiCode,
      quota: estimateResult.quota ?? null,
    };
  }

  const validation = validatePropertyValuation({
    normalized: estimateResult.result,
    context: built.context,
    currentValueCents: source.currentValueCents,
    today: todayKey,
    adjustmentBps: sumAdjustmentBps(source.adjustments),
  });

  if (!validation.ok) {
    if (options.trigger === "auto") {
      recordValuationOutcome({
        propertyId,
        trigger: "auto",
        valuation: null,
        decision: null,
        outcome:
          validation.reason === "not_reliably_valuable"
            ? "not_valuable"
            : "rejected",
        nowIso: completedAtIso,
        markDone: true,
      });
    }

    return {
      kind: "error",
      code: "valuation_rejected",
      reason: validation.reason,
      rationale: estimateResult.result.rationale || undefined,
      message: "Bewertungsergebnis wurde durch Plausibilitätsprüfung abgelehnt.",
    };
  }

  const decision = decideValuationWrite({
    trigger: options.trigger,
    currentSource: source.currentSource,
    currentValueCents: source.currentValueCents,
    warnings: validation.warnings,
  });

  const recorded = recordValuationOutcome({
    propertyId,
    trigger: options.trigger,
    valuation: validation.valuation,
    decision,
    outcome: decision.action === "write" ? "written" : "history_only",
    nowIso: completedAtIso,
    markDone: options.trigger === "auto",
  });

  return {
    kind: "ok",
    valuation: validation.valuation,
    warnings: validation.warnings,
    decision: recorded?.decision ?? decision,
    historyId: recorded?.historyId ?? null,
    requestJson,
    cached: validation.valuation.cached,
    quota: estimateResult.quota,
  };
}
