import { loadPropertyValuationSource } from "@/db/queries/contracts";
import {
  recordValuationOutcome,
  upsertQuotaSnapshot,
} from "@/db/queries/property-valuations";
import type { QuotaSnapshot } from "@/lib/domain/auto-valuation-schedule";
import {
  validatePropertyValuation,
  type PropertyValuation,
  type ValuationRejectReason,
  type ValuationWarning,
} from "@/lib/domain/property-valuation";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  ValuationContextPiiError,
  type ValuationContextUnavailableReason,
} from "@/lib/domain/property-valuation-context";
import {
  decideValuationWrite,
  type ValuationTrigger,
  type ValuationWriteDecision,
} from "@/lib/domain/valuation-write-decision";
import {
  assertRequestHasNoAddress,
  buildImmoAnalyseRequest,
  serializeImmoAnalyseRequest,
} from "@/lib/integrations/immoanalyse-mapping";
import {
  createDefaultPropertyValuator,
  type PropertyValuator,
  type ValuatorErrorCode,
} from "@/lib/integrations/property-valuator";
import { getBerlinClockSnapshot } from "./berlin-clock";

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
  now?: Date;
}

export async function runPropertyValuation(
  propertyId: string,
  options: RunPropertyValuationOptions,
): Promise<RunPropertyValuationResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const todayKey = getBerlinClockSnapshot(now).dateKey;

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
        nowIso,
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

  if (estimateResult.quota) {
    upsertQuotaSnapshot(estimateResult.quota, nowIso);
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
          nowIso,
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
          nowIso,
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
        nowIso,
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
    nowIso,
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
