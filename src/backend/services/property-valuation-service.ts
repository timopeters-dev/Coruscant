import { loadPropertyValuationSource, type PropertyValuationSourceData } from "@/backend/db/queries/contracts";
import { recordValuationOutcome, upsertQuotaSnapshot } from "@/backend/db/queries/property-valuations";
import { ApiError, NotFoundError } from "@/backend/errors";
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
import type { QuotaSnapshot } from "@/domain/properties/valuation/auto-schedule";
import { sumAdjustmentBps } from "@/domain/properties/valuation/adjustments";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  ValuationContextPiiError,
  type PropertyValuationContext,
  type ValuationContextUnavailableReason,
} from "@/domain/properties/valuation/context";
import {
  validatePropertyValuation,
  type PropertyValuation,
  type ValuationRejectReason,
  type ValuationWarning,
} from "@/domain/properties/valuation/valuation";
import {
  decideValuationWrite,
  type ValuationTrigger,
  type ValuationWriteDecision,
} from "@/domain/properties/valuation/write-decision";

export type ValuationErrorCode = "not_found" | "unavailable" | "unsafe" | "valuation_rejected" | ValuatorErrorCode;

export interface ValuationError {
  kind: "error";
  code: ValuationErrorCode;
  message: string;
  reason?: ValuationContextUnavailableReason | ValuationRejectReason;
  rationale?: string;
  httpStatus?: number;
  apiCode?: string;
  quota?: QuotaSnapshot | null;
}

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
  | ValuationError;

type PreparedRequest =
  | { kind: "ok"; source: PropertyValuationSourceData; context: PropertyValuationContext; requestJson: string }
  | ValuationError;

/**
 * Baut den anonymisierten Request an ImmoAnalyse. Unvollständige Objekte und
 * Kontexte mit möglichen personenbezogenen Daten verlassen den Server nie.
 */
export function prepareValuationRequest(propertyId: string, todayKey: string): PreparedRequest {
  const source = loadPropertyValuationSource(propertyId, todayKey);
  if (!source) return { kind: "error", code: "not_found", message: "Immobilie nicht gefunden." };

  const built = buildPropertyValuationContext(source.contextInput);
  if (!built.ok) {
    return { kind: "error", code: "unavailable", reason: built.reason, message: "Objektkontext für die Wertschätzung unvollständig." };
  }
  try {
    assertValuationContextSafe(built.context, source.contextInput.forbiddenTerms);
    const body = buildImmoAnalyseRequest(built.context);
    assertRequestHasNoAddress(body);
    return { kind: "ok", source, context: built.context, requestJson: serializeImmoAnalyseRequest(body) };
  } catch (error) {
    if (error instanceof ValuationContextPiiError) {
      return { kind: "error", code: "unsafe", message: "Kontext enthält potenziell personenbezogene Daten." };
    }
    throw error;
  }
}

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
  const todayKey = getBerlinClockSnapshot(startNow).dateKey;

  /** Automatische Läufe protokollieren auch Fehlschläge am Objekt. */
  const recordAutoFailure = (outcome: "not_valuable" | "rejected" | "error", nowIso: string, markDone: boolean) => {
    if (options.trigger !== "auto") return;
    recordValuationOutcome({ propertyId, trigger: "auto", valuation: null, decision: null, outcome, nowIso, markDone });
  };

  const prepared = prepareValuationRequest(propertyId, todayKey);
  if (prepared.kind === "error") {
    if (prepared.code === "unavailable") recordAutoFailure("not_valuable", startNow.toISOString(), false);
    return prepared;
  }
  const { source, context, requestJson } = prepared;

  const valuator = options.valuator ?? createDefaultPropertyValuator(todayKey);
  const estimate = await valuator.estimate(requestJson);
  const completedAtIso = getNow().toISOString();
  if (estimate.quota) upsertQuotaSnapshot(estimate.quota, completedAtIso);

  if (!estimate.ok) {
    if (estimate.code === "not_valuable") recordAutoFailure("not_valuable", completedAtIso, true);
    // Ungültiger Schlüssel und leeres Kontingent sind kein Objektproblem.
    else if (estimate.code !== "unauthorized" && estimate.code !== "quota_exceeded") recordAutoFailure("error", completedAtIso, false);
    return {
      kind: "error",
      code: estimate.code,
      message: estimate.message,
      httpStatus: estimate.httpStatus,
      apiCode: estimate.apiCode,
      quota: estimate.quota ?? null,
    };
  }

  const validation = validatePropertyValuation({
    normalized: estimate.result,
    context,
    currentValueCents: source.currentValueCents,
    today: todayKey,
    adjustmentBps: sumAdjustmentBps(source.adjustments),
  });
  if (!validation.ok) {
    recordAutoFailure(validation.reason === "not_reliably_valuable" ? "not_valuable" : "rejected", completedAtIso, true);
    return {
      kind: "error",
      code: "valuation_rejected",
      reason: validation.reason,
      rationale: estimate.result.rationale || undefined,
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
    quota: estimate.quota,
  };
}

const UNAVAILABLE_MESSAGE: Record<ValuationContextUnavailableReason, string> = {
  missing_postal_code: "Gültige 5-stellige PLZ im Objekt pflegen, um eine Schätzung zu erhalten.",
  missing_living_area: "Wohnfläche im Objekt pflegen, um eine Schätzung zu erhalten.",
  missing_property_type: "Objekttyp im Objekt pflegen, um eine Schätzung zu erhalten.",
};

const STATUS_BY_VALUATOR_CODE: Record<ValuatorErrorCode, number> = {
  not_configured: 503,
  unauthorized: 502,
  quota_exceeded: 429,
  rate_limited: 429,
  not_valuable: 422,
  invalid_request: 502,
  timeout: 504,
  http_error: 502,
  network_error: 502,
  invalid_payload: 502,
};

/** Übersetzt einen Bewertungsfehler in die API-Antwort (`code` + `error`). */
export function toValuationApiError(error: ValuationError): ApiError {
  switch (error.code) {
    case "not_found":
      return new NotFoundError(error.message);
    case "unavailable": {
      const reason = error.reason as ValuationContextUnavailableReason;
      return new ApiError(422, UNAVAILABLE_MESSAGE[reason], { code: "valuation_context_unavailable", reason });
    }
    case "unsafe":
      return new ApiError(422, "Kontext enthält potenziell personenbezogene Daten und wird nicht gesendet.", {
        code: "valuation_context_unsafe",
      });
    case "valuation_rejected":
      return new ApiError(422, error.message, {
        code: "valuation_rejected",
        reason: error.reason,
        ...(error.rationale ? { rationale: error.rationale } : {}),
      });
    case "quota_exceeded":
      return new ApiError(429, error.message, { code: "quota_exceeded", resetAt: error.quota?.resetAt ?? null });
    case "not_valuable":
      return new ApiError(422, error.message, { code: "not_valuable", ...(error.apiCode ? { apiCode: error.apiCode } : {}) });
    default:
      return new ApiError(STATUS_BY_VALUATOR_CODE[error.code], error.message, { code: error.code });
  }
}
